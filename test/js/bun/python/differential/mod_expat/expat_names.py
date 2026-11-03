# Which characters names may start with and go on with.
# (EXPAT_NAMES_ALL=1 tries every character of the basic plane in every place: minutes in a debug build.)
import os
from xml.parsers import expat

everything = bool(os.environ.get('EXPAT_NAMES_ALL'))

def candidates():
    yield from range(0x21, 0x500 if not everything else 0x10000)
    if not everything:
        yield from range(0x500, 0x3200, 13)
        for c in (0x3400, 0x4dff, 0x4e00, 0x4e01, 0x9fa5, 0x9fa6, 0xa000, 0xabff, 0xac00, 0xd7a3, 0xd7a4, 0xe000, 0xf900, 0xfb00, 0xfdf0, 0xfeff, 0xff21, 0xfffd, 0xfffe, 0xffff):
            yield c

def accepted(template, encoding='utf-8', declaration=''):
    out = []
    for c in candidates():
        if 0xd800 <= c < 0xe000: continue
        try: data = (declaration + template % chr(c)).encode(encoding)
        except UnicodeError: continue
        try:
            expat.ParserCreate().Parse(data, True)
            ok = True
        except expat.ExpatError:
            ok = False
        if ok:
            if out and out[-1][1] == c - 1: out[-1][1] = c
            else: out.append([c, c])
    return ' '.join('%x-%x' % (a, b) if a != b else '%x' % a for a, b in out)

print(accepted('<%s/>'))
print(accepted('<a%s/>'))
if everything:
    print(accepted('<a %s="1"/>'))
    print(accepted('<a><?x%s ?></a>', 'utf-16'))
    print(accepted('<!DOCTYPE a [<!ENTITY e%s "x">]><a/>'))
for encoding, declaration in (('latin-1', '<?xml version="1.0" encoding="iso-8859-1"?>'), ('cp1252', '<?xml version="1.0" encoding="cp1252"?>'), ('latin-1', '<?xml version="1.0" encoding="latin-1"?>'), ('koi8-r', '<?xml version="1.0" encoding="koi8-r"?>')):
    print(encoding, declaration, accepted('<%s/>', encoding, declaration), '|', accepted('<a%s/>', encoding, declaration))
for c in (0xaa, 0xb5, 0xb7, 0xba, 0xc0):
    for encoding in ('utf-8', 'utf-16', 'utf-16-le', 'utf-16-be'):
        for template in ('<%s/>', '<a%s/>', '<!DOCTYPE a [<!ENTITY e "<%s/>">]><a>&e;</a>', '<!DOCTYPE a [<!ENTITY %s "x"><!ENTITY e "&%s;">]><a b="&e;">&e;</a>', '<!DOCTYPE a [<!ENTITY %% p "<!ELEMENT %s ANY>">%%p;]><a/>'):
            try: print(hex(c), encoding, template, expat.ParserCreate().Parse(template.replace('%s', chr(c)).replace('%%', '%').encode(encoding), True))
            except expat.ExpatError as e: print(hex(c), encoding, template, e)
for c in (0x10000, 0x10400, 0x1f600, 0x20000, 0xeffff, 0x10ffff):
    for template in ('<%s/>', '<a%s/>', '<a>%s</a>', '<a b="%s"/>'):
        try: print(hex(c), template, expat.ParserCreate().Parse((template % chr(c)).encode(), True))
        except expat.ExpatError as e: print(hex(c), template, e)
