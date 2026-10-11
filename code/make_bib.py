"""Generate BibTeX and RIS from the APA 7 reference list (13_references.md)."""
import re, unicodedata, sys
from collections import Counter

SRC = '/mnt/user-data/outputs/manuscript/13_references.md'
lines, s = [], False
for l in open(SRC, encoding='utf-8'):
    l = l.strip()
    if l.startswith('### أولاً'):
        s = True; continue
    if l.startswith('---'):
        break
    if s and l and not l.startswith('#'):
        lines.append(l)

AR = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')
YEAR = r'(?:[^()]*?\d{4}[a-z]?[^()]*?|n\.d\.|د\.ت\.|in press|[٠-٩]{4})'
ORGS = ('UNESCO', 'UNCTAD', 'OECD', 'CISAC', 'EPTA', 'Eduskunta', 'Centre', 'Compendium', 'Dubai', 'Government',
        'International Journal', 'Ministry', 'National Arts', 'University', 'The future')


def parse(l):
    m = re.match(r'^(.*?)\s*\((' + YEAR + r')\)\.\s*(.*)$', l)
    auth, yr, rest = m.group(1).rstrip('.').strip(), m.group(2), m.group(3)
    y4 = re.search(r'\d{4}[a-z]?', yr.translate(AR))
    year = y4.group(0) if y4 else ('n.d.' if ('n.d' in yr or 'د.ت' in yr) else yr)
    url = re.search(r'(https?://\S+)$', rest)
    url = url.group(1) if url else ''
    doi = re.search(r'doi\.org/(\S+)$', url)
    doi = doi.group(1) if doi else ''
    body = rest[:rest.rfind(url)].strip() if url else rest
    body = re.sub(r'Retrieved [^,]+, from\s*$', '', body).strip()
    ital = re.findall(r'\*([^*]+)\*', body)
    e = dict(auth=auth, year=year, url=url, doi=doi, raw=l)
    editors = '(Ed.)' in auth or '(Eds.)' in auth
    e['auth'] = auth.replace(' (Eds.)', '').replace(' (Ed.)', '').rstrip('.')
    e['editors'] = editors
    art = re.match(r'^(.*?)\s+\*([^*]+?)(?:,\s*([^*,]+))?\*(?:\(([^)]+)\))?(?:,\s*([^.]+))?\.', body)
    arj = re.match(r'^(.*?)\.\s+\*([^*]+)\*،\s*\(([^)]+)\)(?:،\s*([^.]+))?\.', body)  # Arabic journal
    if body.startswith('*'):
        e['type'] = 'book'; e['title'] = ital[0]
        tail = body.split('*')[-1].strip(' .')
        tail = re.sub(r'^\[[^\]]*\]\.?\s*', '', tail)
        tail = re.sub(r'^\([^)]*\)\.?\s*', '', tail)
        e['publisher'] = re.sub(r'\.?\s*Retrieved.*$', '', tail).strip(' .')
        if e['publisher'].startswith('Retrieved'): e['publisher'] = ''
    elif '. In ' in body:
        e['type'] = 'incollection'; e['title'] = body.split('. In ')[0]
        e['booktitle'] = ital[-1] if ital else ''
        pg = re.search(r'pp\. ([\d–-]+)', body); e['pages'] = pg.group(1) if pg else ''
        e['publisher'] = body.rsplit(').', 1)[-1].strip(' .') if ').' in body else body.rsplit('.', 2)[-2].strip()
    elif arj:
        e['type'] = 'article'; e['title'] = arj.group(1); e['journal'] = arj.group(2)
        e['volume'] = ''; e['issue'] = arj.group(3).translate(AR); e['pages'] = (arj.group(4) or '').translate(AR).strip('–')
    elif art:
        e['type'] = 'article'; e['title'] = art.group(1).rstrip('.'); e['journal'] = art.group(2).strip(' ,')
        e['volume'] = (art.group(3) or '').strip(); e['issue'] = (art.group(4) or '')
        e['pages'] = (art.group(5) or '').strip()
        if e['pages'].startswith('Article'):
            e['pages'] = e['pages'].replace('Article ', '')
    else:
        e['type'] = 'misc'; e['title'] = body.split('*')[0].strip(' .') or body
    if e['auth'].startswith('The future of cultural policy'):
        e.update(type='article', title='The future of cultural policy [Editorial]', journal='Nordisk kulturpolitisk tidsskrift', volume='28', issue='2', pages='', auth='{Editorial}')
    return e


def split_authors(a):
    if a.startswith(ORGS) or not re.search(r'[A-Z]\.', a):
        return None
    a = a.replace('…', ',').replace('& ', '')
    toks = [t.strip() for t in a.split(',') if t.strip()]
    names = []
    for i in range(0, len(toks) - 1, 2):
        names.append(f'{toks[i]}, {toks[i + 1]}')
    return names or None


E = [parse(l) for l in lines]
bib, ris, keys = [], [], []
for i, e in enumerate(E):
    first = e['auth'].split(',')[0].split()[0] if e['auth'] else 'anon'
    base = re.sub(r'[^A-Za-z]', '', unicodedata.normalize('NFKD', first)) or f'ar{i:02d}'
    k = base + e['year'].replace('.', '')
    while k in keys:
        k += 'x'
    keys.append(k)
    names = split_authors(e['auth'])
    bauth = ' and '.join(names) if names else '{' + e['auth'] + '}'
    role = 'editor' if e['editors'] else 'author'
    f = {role: bauth, 'title': '{' + e['title'] + '}', 'year': e['year']}
    t = e['type']
    if t == 'article':
        f.update(journal=e['journal'], volume=e.get('volume', ''), number=e.get('issue', ''),
                 pages=e.get('pages', '').replace('–', '--'))
    if t == 'book':
        f['publisher'] = e.get('publisher', '')
    if t == 'incollection':
        f.update(booktitle=e['booktitle'], pages=e.get('pages', '').replace('–', '--'), publisher=e.get('publisher', ''))
    if e['doi']:
        f['doi'] = e['doi']
    if e['url'] and not e['doi']:
        f['url'] = e['url']
    f['note'] = '{APA 7: ' + e['raw'].replace('*', '').replace('{', '').replace('}', '') + '}'
    fields = []
    for a, v in f.items():
        if not v:
            continue
        fields.append(f'  {a} = {v}' if str(v).startswith('{') else f'  {a} = {{{v}}}')
    bib.append('@' + t + '{' + k + ',\n' + ',\n'.join(fields) + '\n}\n')
    ty = {'article': 'JOUR', 'book': 'BOOK', 'incollection': 'CHAP', 'misc': 'ELEC'}[t]
    r = [f'TY  - {ty}']
    tag = 'ED' if e['editors'] else 'AU'
    r += [f'{tag}  - {a}' for a in (names or [e['auth']])]
    r += [f'PY  - {e["year"]}', f'TI  - {e["title"]}']
    if t == 'article':
        r += [f'JO  - {e["journal"]}', f'VL  - {e.get("volume", "")}', f'IS  - {e.get("issue", "")}']
        if e.get('pages'):
            pp = e['pages'].split('–')
            r += [f'SP  - {pp[0]}', f'EP  - {pp[-1]}' if len(pp) > 1 else '']
    if t in ('book', 'incollection') and e.get('publisher'):
        r.append(f'PB  - {e["publisher"]}')
    if t == 'incollection':
        r.append(f'T2  - {e["booktitle"]}')
    if e['doi']:
        r.append(f'DO  - {e["doi"]}')
    if e['url']:
        r.append(f'UR  - {e["url"]}')
    r.append('ER  - ')
    ris.append('\n'.join(x for x in r if x and (not x.rstrip().endswith('-') or x.startswith('ER'))))

open('CPFRA-X_references.bib', 'w', encoding='utf-8').write(
    '% CPFRA-X references — generated from the APA 7 list (13_references.md), 2026-10-11.\n'
    '% The note field keeps the verified APA string; prefer it where a parsed field looks incomplete.\n\n' + '\n'.join(bib))
open('CPFRA-X_references.ris', 'w', encoding='utf-8').write('\n\n'.join(ris) + '\n')
print(len(E), Counter(e['type'] for e in E))
for e in E:
    print(e['type'][:4], '|', e['year'], '|', e['auth'][:30], '|', e['title'][:50], '|', e.get('journal', e.get('publisher', ''))[:30], e.get('volume', ''), e.get('issue', ''), e.get('pages', ''))
