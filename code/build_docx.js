// Build the Arabic manuscript as an RTL Word document with real footnotes.
const fs = require('fs');
const d = require('docx');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, FootnoteReferenceRun, Footer, Header, PageNumber,
  TableOfContents, LevelFormat, PageBreak, Math: OMath, MathRun, MathFraction, MathSubScript,
  MathSuperScript, VerticalAlign, TabStopType,
} = d;

const SRC = process.argv[2];
const OUT = process.argv[3];
const BLUE = '1F4E79', GOLD = 'B8860B', LIGHT = 'EAF1F8', GOLDLIGHT = 'FBF5E6';
const FONT = 'Noto Naskh Arabic';
const LATIN = 'Times New Roman';
const BODY = 26; // 13pt
const PAGE_W = 11906, MARGIN = 1300, TEXT_W = PAGE_W - 2 * MARGIN;

const md = fs.readFileSync(SRC, 'utf8').split('\n');

// ---------- references ----------
const toLatinDigits = s => s.replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660));
const normYear = y => toLatinDigits(y.trim()).replace('د.ت.', 'n.d.').toLowerCase();
const refStart = md.findIndex(l => l.trim() === '## المراجع');
const refs = [];
for (let i = refStart + 1; i < md.length; i++) {
  const l = md[i].trim();
  if (l.startsWith('---')) break;
  if (!l || l.startsWith('#')) continue;
  const m = l.match(/\((\d{4}[ab]?|[٠-٩]{4}|n\.d\.|د\.ت\.|in press)[^)]*\)/);
  refs.push({ text: l, year: m ? normYear(m[1]) : '?', lc: l.toLowerCase() });
}
function findRef(author, year) {
  let a = author.replace(/[«»"“”]/g, '').replace(/\bet al\.?/, '').trim();
  a = a.split(/\s*&\s*|\s+و(?=[A-Z])|,/)[0].trim();
  const y = normYear(year);
  const cands = refs.filter(r => r.year === y && r.lc.startsWith(a.toLowerCase()));
  if (cands.length >= 1) return cands[0];
  // Arabic author written without the definite article or with a short org name
  const c2 = refs.filter(r => r.year === y && r.lc.includes(a.toLowerCase().slice(0, 12)));
  return c2.length ? c2[0] : null;
}

// ---------- footnotes ----------
const footnotes = {};
let fnId = 0;
const unmatched = [];
function addFootnote(refList) {
  fnId += 1;
  const children = refList.map(r => mkPara(r.text, { size: 18, footnote: true, noCite: true, spacingAfter: 40 }));
  footnotes[fnId] = { children };
  return fnId;
}

// ---------- script-aware runs ----------
const isAr = ch => /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(ch);
const isLat = ch => /[A-Za-z0-9À-ɏͰ-Ͽ∗*^_=+−]/.test(ch) && !isAr(ch);
function splitScript(text, baseRtl) {
  const cls = [...text].map(ch => (isAr(ch) ? 'R' : isLat(ch) ? 'L' : 'N'));
  const chars = [...text];
  // resolve neutrals: same class on both sides -> that class, else paragraph base
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] !== 'N') continue;
    let j = i; while (j < cls.length && cls[j] === 'N') j++;
    const prev = i > 0 ? cls[i - 1] : (baseRtl ? 'R' : 'L');
    const next = j < cls.length ? cls[j] : (baseRtl ? 'R' : 'L');
    const v = prev === next ? prev : (baseRtl ? 'R' : 'L');
    for (let k = i; k < j; k++) cls[k] = v;
    i = j - 1;
  }
  const out = [];
  for (let i = 0; i < chars.length; i++) {
    if (out.length && out[out.length - 1].c === cls[i]) out[out.length - 1].t += chars[i];
    else out.push({ c: cls[i], t: chars[i] });
  }
  return out;
}
function runs(text, fmt) {
  return splitScript(text, fmt.rtl).map(s => new TextRun({
    text: s.t,
    rightToLeft: s.c === 'R',
    bold: fmt.bold, boldComplexScript: fmt.bold,
    italics: fmt.italic && s.c !== 'R', italicsComplexScript: false,
    color: fmt.color,
    size: fmt.size, sizeComplexScript: fmt.size,
    font: { ascii: LATIN, hAnsi: LATIN, cs: FONT, eastAsia: FONT },
  }));
}

// ---------- inline parsing (bold / italic / citations) ----------
const YEAR = '(?:\\d{4}[ab]?|[٠-٩]{4}|in press|n\\.d\\.|د\\.ت\\.)';
const PAREN = /\s?\(([^()]{2,400})\)/g;
const SEG = new RegExp('^(.{1,90}?)[,،]\\s*(' + YEAR + ')$');
const NARR = new RegExp("([A-Z][A-Za-zÀ-ÿ'\\-]+(?:(?: et al\\.)|(?: ?(?:&|و) ?[A-Z][A-Za-zÀ-ÿ'\\-]+)*)) \\((" + YEAR + ')\\)', 'g');

function citeTokens(text, noCite) {
  // returns array of {t:text} | {fn:id}
  if (noCite) return [{ t: text }];
  const out = [];
  let last = 0;
  const marks = [];
  let m;
  PAREN.lastIndex = 0;
  while ((m = PAREN.exec(text))) {
    const segs = m[1].split(/\s*[;؛]\s*/);
    const parsed = segs.map(s => s.match(SEG));
    if (!parsed.every(Boolean)) continue;
    const rs = parsed.map(p => findRef(p[1], p[2]));
    if (rs.some(r => !r)) { unmatched.push(m[0]); continue; }
    marks.push({ s: m.index, e: m.index + m[0].length, refs: rs, keep: false });
  }
  NARR.lastIndex = 0;
  while ((m = NARR.exec(text))) {
    if (marks.some(k => m.index < k.e && m.index + m[0].length > k.s)) continue;
    const r = findRef(m[1], m[2]);
    if (!r) { unmatched.push(m[0]); continue; }
    marks.push({ s: m.index, e: m.index + m[0].length, refs: [r], keep: true });
  }
  marks.sort((a, b) => a.s - b.s);
  for (const k of marks) {
    out.push({ t: text.slice(last, k.keep ? k.e : k.s) });
    out.push({ fn: addFootnote(k.refs) });
    last = k.e;
  }
  out.push({ t: text.slice(last) });
  return out;
}

function inline(text, base) {
  // split by **bold** and *italic*
  const parts = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index), b: false, i: false });
    if (m[0].startsWith('**')) parts.push({ t: m[0].slice(2, -2), b: true, i: false });
    else parts.push({ t: m[0].slice(1, -1), b: false, i: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ t: text.slice(last), b: false, i: false });
  const children = [];
  for (const p of parts) {
    for (const tok of citeTokens(p.t, base.noCite)) {
      if (tok.fn) children.push(new FootnoteReferenceRun(tok.fn));
      else if (tok.t) children.push(...runs(tok.t, { ...base, bold: p.b || base.bold, italic: p.i || base.italic }));
    }
  }
  return children;
}

const arabicShare = s => { const a = (s.match(/[؀-ۿ]/g) || []).length; const l = (s.match(/[A-Za-z]/g) || []).length; return a / (a + l + 1e-9); };

function mkPara(text, o = {}) {
  const rtl = o.rtl !== undefined ? o.rtl : arabicShare(text) > 0.3;
  return new Paragraph({
    bidirectional: rtl,
    alignment: o.align || (rtl && process.env.PDFMODE ? AlignmentType.RIGHT : AlignmentType.JUSTIFIED),
    spacing: { after: o.spacingAfter ?? 120, line: o.line ?? (o.footnote ? 240 : 336) },
    indent: o.indent,
    border: o.border,
    shading: o.shading,
    keepNext: o.keepNext,
    children: inline(text, { rtl, size: o.size || BODY, color: o.color, bold: o.bold, italic: o.italic, noCite: o.noCite }),
  });
}

// ---------- equations ----------
const mr = t => new MathRun(t);
const frac = (n, dd) => new MathFraction({ numerator: n, denominator: dd });
const sub = (b, s) => new MathSubScript({ children: b, subScript: s });
const sup = (b, s) => new MathSuperScript({ children: b, superScript: s });
const EQS = {
  model: [
    frac([mr('dEV')], [mr('dt')]), mr(' = (0.04 + 0.04m)·EV,     '),
    frac([mr('dIC')], [mr('dt')]), mr(' = a·aut·IC(1 − IC) − b·m·IC + c·max(0, '),
    sub([mr('IC')], [mr('0')]), mr(' − '), sub([mr('IC')], [mr('t−τ')]), mr(')'),
  ],
  thresh: [
    sup([mr('IC')], [mr('*')]), mr(' = 1 − '), frac([mr('b·m')], [mr('a·aut')]), mr(',     '),
    sup([mr('m')], [mr('*')]), mr(' = '), frac([mr('a·aut')], [mr('b')]),
  ],
  levins: [
    frac([mr('dp')], [mr('dt')]), mr(' = c·p(1 − p) − e·p,     '),
    sup([mr('p')], [mr('*')]), mr(' = 1 − '), frac([mr('e')], [mr('c')]),
  ],
};
function eqPara(src) {
  const key = src.includes('dEV') ? 'model' : src.includes('IC^{*}') ? 'thresh' : src.includes('dp') ? 'levins' : null;
  if (!key) throw new Error('unknown equation ' + src);
  return new Paragraph({
    alignment: AlignmentType.CENTER, bidirectional: false,
    spacing: { before: 120, after: 160 },
    shading: { type: ShadingType.CLEAR, fill: GOLDLIGHT, color: 'auto' },
    children: [new OMath({ children: EQS[key] })],
  });
}

// ---------- tables ----------
const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
function mkTable(rows) {
  const cells = rows.map(r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
  const header = cells[0];
  const body = cells.slice(2);
  const n = header.length;
  const lens = header.map((_, j) => Math.max(...cells.filter((_, i) => i !== 1).map(r => Math.min((r[j] || '').length, 60)), 4));
  const tot = lens.reduce((a, b) => a + b, 0);
  let widths = lens.map(l => Math.max(900, Math.round(TEXT_W * l / tot)));
  const s = widths.reduce((a, b) => a + b, 0);
  widths = widths.map(w => Math.round(w * TEXT_W / s));
  widths[n - 1] += TEXT_W - widths.reduce((a, b) => a + b, 0);
  const mkRow = (r, isHead, idx) => new TableRow({
    tableHeader: isHead,
    cantSplit: false,
    children: r.map((c, j) => new TableCell({
      width: { size: widths[j], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: isHead ? BLUE : (idx % 2 ? LIGHT : 'FFFFFF') },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      verticalAlign: VerticalAlign.CENTER,
      borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder },
      children: [new Paragraph({
        bidirectional: arabicShare(c) > 0.3 || c === '' || /^[٠-٩+\-−٪%.,٫ ()]+$/.test(c),
        alignment: AlignmentType.RIGHT,
        spacing: { after: 0, line: 276 },
        children: inline(c, { rtl: arabicShare(c) > 0.3, size: 20, bold: isHead, color: isHead ? 'FFFFFF' : undefined }),
      })],
    })),
  });
  return new Table({
    visuallyRightToLeft: true,
    width: { size: TEXT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [mkRow(header, true, 0), ...body.map((r, i) => mkRow(r, false, i))],
  });
}


// ---------- static TOC for the PDF rendition ----------
function staticToc() {
  const pages = process.env.TOCPAGES ? JSON.parse(fs.readFileSync(process.env.TOCPAGES, 'utf8')) : {};
  const heads = [];
  let started = false;
  for (const l of md) {
    if (l.startsWith('## ١.')) started = true;
    if (!started) continue;
    if (l.startsWith('## ')) heads.push({ lvl: 1, t: l.slice(3).trim() });
    else if (l.startsWith('### ') && !l.includes('أولاً') && !l.includes('ثانياً')) heads.push({ lvl: 2, t: l.slice(4).trim() });
  }
  const w1 = TEXT_W - 900;
  const nb = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const dot = { style: BorderStyle.DOTTED, size: 4, color: 'BFBFBF' };
  return new Table({
    visuallyRightToLeft: true, width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: [w1, 900],
    borders: { top: nb, bottom: nb, left: nb, right: nb, insideHorizontal: nb, insideVertical: nb },
    rows: heads.map(h => new TableRow({ children: [
      new TableCell({ width: { size: w1, type: WidthType.DXA }, borders: { top: nb, left: nb, right: nb, bottom: dot },
        children: [new Paragraph({ bidirectional: true, alignment: AlignmentType.RIGHT, indent: h.lvl === 2 ? { start: 400 } : undefined, spacing: { after: 0, before: h.lvl === 1 ? 80 : 0, line: 260 },
          children: runs(h.t, { rtl: true, size: h.lvl === 1 ? 22 : 19, bold: h.lvl === 1, color: h.lvl === 1 ? BLUE : undefined }) })] }),
      new TableCell({ width: { size: 900, type: WidthType.DXA }, borders: { top: nb, left: nb, right: nb, bottom: dot },
        children: [new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 0, before: h.lvl === 1 ? 80 : 0, line: 260 },
          children: [new TextRun({ text: String(pages[h.t] || '00'), size: h.lvl === 1 ? 22 : 19, bold: h.lvl === 1, color: GOLD })] })] }),
    ] })),
  });
}

// ---------- document body ----------
const children = [];
// cover
const titleLine = md[0].replace(/^#\s*/, '');
children.push(new Paragraph({ spacing: { before: 2400, after: 200 }, children: [] }));
children.push(new Paragraph({
  bidirectional: true, alignment: AlignmentType.CENTER, spacing: { after: 360 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 12 } },
  children: runs(titleLine, { rtl: true, size: 44, bold: true, color: BLUE }),
}));
children.push(mkPara('ورقة بحثية محكّمة داخلياً — المخطوطة العربية الموسّعة', { align: AlignmentType.CENTER, size: 28, color: GOLD, bold: true, noCite: true }));
children.push(new Paragraph({ spacing: { before: 1200 }, children: [] }));
children.push(mkPara('د. ماجد عبدالله بوشليبي', { align: AlignmentType.CENTER, size: 30, bold: true, color: BLUE, noCite: true }));
children.push(mkPara('باحث ومستشار في السياسات الثقافية', { align: AlignmentType.CENTER, size: 24, noCite: true }));
children.push(mkPara('أكتوبر ٢٠٢٦', { align: AlignmentType.CENTER, size: 24, noCite: true }));
children.push(new Paragraph({ spacing: { before: 1600 }, children: [] }));
children.push(mkPara('إفصاح: استُعين في إعداد هذه الورقة بنظام ذكاء اصطناعي في استرجاع الأدبيات والتحقق المرجعي وبرمجة المحاكاة وصياغة المسودات، وراجع المؤلف المحتوى ويتحمل وحده مسؤوليته العلمية (انظر ٥-١٢).', { align: AlignmentType.CENTER, size: 20, italic: false, color: '595959', noCite: true }));
children.push(new Paragraph({ children: [new PageBreak()] }));

let i = 0;
// skip the md header block (title, subtitle line, blockquote)
while (i < md.length && !md[i].startsWith('## ')) i++;
let tocInserted = false;
let inRefs = false;
let olCounter = 0;
while (i < md.length) {
  const raw = md[i];
  const l = raw.trim();
  if (!l) { i++; continue; }
  if (l.startsWith('```')) {
    const buf = []; i++;
    while (i < md.length && !md[i].trim().startsWith('```')) { buf.push(md[i]); i++; }
    i++; children.push(eqPara(buf.join(' '))); continue;
  }
  if (l.startsWith('|')) {
    const rows = [];
    while (i < md.length && md[i].trim().startsWith('|')) { rows.push(md[i].trim()); i++; }
    children.push(mkTable(rows));
    children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    continue;
  }
  if (l.startsWith('## ')) {
    const h = l.slice(3);
    const isEn = h === 'Abstract';
    if (h.startsWith('١.') && !tocInserted) {
      // TOC before the body sections
      children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(new Paragraph({ bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { after: 200 }, children: runs('المحتويات', { rtl: true, size: 32, bold: true, color: BLUE }) }));
      if (process.env.PDFMODE) children.push(staticToc()); else children.push(new TableOfContents('المحتويات', { hyperlink: true, headingStyleRange: '1-2' }));
      children.push(new Paragraph({ children: [new PageBreak()] }));
      tocInserted = true;
    } else if (h === 'المراجع' || h === 'Abstract') {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
    if (h === 'المراجع') inRefs = true;
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1, bidirectional: !isEn,
      alignment: isEn ? AlignmentType.LEFT : AlignmentType.RIGHT,
      children: runs(h, { rtl: !isEn, size: 34, bold: true, color: BLUE }),
    }));
    i++; continue;
  }
  if (l.startsWith('### ')) {
    const h = l.slice(4);
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2, bidirectional: true, alignment: AlignmentType.RIGHT,
      children: runs(h, { rtl: true, size: 28, bold: true, color: BLUE }),
    }));
    i++; continue;
  }
  if (l.startsWith('---')) {
    children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } }, spacing: { after: 160 }, children: [] }));
    i++; continue;
  }
  let m;
  if ((m = l.match(/^(\d+)\.\s+(.*)$/))) {
    children.push(new Paragraph({
      bidirectional: true, alignment: process.env.PDFMODE ? AlignmentType.RIGHT : AlignmentType.JUSTIFIED,
      numbering: { reference: 'ol', level: 0, instance: olCounter },
      spacing: { after: 80, line: 336 },
      children: inline(m[2], { rtl: true, size: BODY }),
    }));
    i++;
    if (!(md[i] || '').trim().match(/^\d+\.\s/)) olCounter++;
    continue;
  }
  if ((m = l.match(/^[-*]\s+(.*)$/))) {
    children.push(new Paragraph({
      bidirectional: true, alignment: process.env.PDFMODE ? AlignmentType.RIGHT : AlignmentType.JUSTIFIED,
      numbering: { reference: 'ul', level: 0 },
      spacing: { after: 80, line: 336 },
      children: inline(m[1], { rtl: true, size: BODY }),
    }));
    i++; continue;
  }
  if (inRefs) {
    const rtl = arabicShare(l) > 0.3;
    children.push(mkPara(l, { noCite: true, rtl, size: 22, align: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT, indent: { hanging: 567, left: 567 }, line: 276 }));
    i++; continue;
  }
  children.push(mkPara(l, { noCite: l.startsWith('**الكلمات') || l.startsWith('**Keywords') }));
  i++;
}

const doc = new Document({
  creator: 'د. ماجد عبدالله بوشليبي',
  title: titleLine,
  description: 'CPFRA-X — المخطوطة العربية الموسعة',
  features: { updateFields: true },
  styles: {
    default: { document: { run: { font: { ascii: LATIN, hAnsi: LATIN, cs: FONT }, size: BODY, sizeComplexScript: BODY }, paragraph: { spacing: { line: 336 } } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: { ascii: LATIN, hAnsi: LATIN, cs: FONT }, size: 34, sizeComplexScript: 34, bold: true, boldComplexScript: true, color: BLUE },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: GOLD, space: 6 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: { ascii: LATIN, hAnsi: LATIN, cs: FONT }, size: 28, sizeComplexScript: 28, bold: true, boldComplexScript: true, color: BLUE },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1, keepNext: true } },
      { id: 'FootnoteText', name: 'footnote text', basedOn: 'Normal', run: { size: 18, sizeComplexScript: 18 }, paragraph: { spacing: { after: 40, line: 240 } } },
    ],
  },
  numbering: {
    config: [
      { reference: 'ol', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 567, hanging: 340 } } } }] },
      { reference: 'ul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 567, hanging: 340 } }, run: { color: GOLD } } }] },
    ],
  },
  footnotes,
  sections: [{
    properties: {
      page: { size: { width: PAGE_W, height: 16838 }, margin: { top: 1300, bottom: 1300, left: MARGIN, right: MARGIN } },
      titlePage: true,
    },
    headers: {
      default: new Header({ children: [new Paragraph({ bidirectional: true, alignment: AlignmentType.CENTER, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GOLD, space: 4 } }, children: runs('مسارات تباعد القيمة — الدراسات المستقبلية للسياسات الثقافية', { rtl: true, size: 18, color: BLUE }) })] }),
      first: new Header({ children: [new Paragraph({ children: [] })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 20, color: BLUE })] })] }),
      first: new Footer({ children: [new Paragraph({ children: [] })] }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log('footnotes:', fnId, 'unmatched:', unmatched.length);
  if (unmatched.length) console.log([...new Set(unmatched)].join('\n'));
});
