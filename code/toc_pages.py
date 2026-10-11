import sys,json,pypdf
pdf,out=sys.argv[1:3]
r=pypdf.PdfReader(pdf); pages={}
def walk(o):
    for x in o:
        if isinstance(x,list): walk(x)
        else: pages.setdefault(x.title.strip(), r.get_destination_page_number(x)+1)
walk(r.outline)
json.dump(pages,open(out,'w'),ensure_ascii=False); print(len(pages))
