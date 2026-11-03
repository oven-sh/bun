# External entities: the parsers that ExternalEntityParserCreate makes; the external subset, with conditional sections and
# references to parameter entities within declarations.
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from expat_common import HANDLERS
from xml.parsers import expat

def parse(doc, files={}, pe=expat.XML_PARAM_ENTITY_PARSING_ALWAYS, chunks=None, default=None, swallow=False, encoding=None, foreign=None, **kw):
    out = []
    stack = []
    def where():
        p = stack[-1]
        return (len(stack), p.CurrentLineNumber, p.CurrentColumnNumber, p.CurrentByteIndex)
    def make(name):
        def h(*a):
            out.append((name[:-7], a) + where())
            return 1
        return h
    def feed(p, data):
        stack.append(p)
        try:
            if chunks:
                for i in range(0, len(data), chunks): p.Parse(data[i:i + chunks], False)
                return p.Parse(b'', True)
            return p.Parse(data, True)
        finally:
            stack.pop()
    def external(context, base, system, public):
        # (The order within the context is that of a hash table with a random seed.)
        out.append(('ExternalEntityRef', (context and sorted(context.split('\f')), base, system, public)) + where())
        if system not in files:
            return 1 if system is None or not system.startswith('fail') else 0
        child = stack[-1].ExternalEntityParserCreate(context, *([encoding] if encoding else []))
        try:
            out.append(('child result', feed(child, files[system])))
        except expat.ExpatError as e:
            out.append(('child error', str(e), e.code, child.ErrorLineNumber, child.ErrorColumnNumber, child.ErrorByteIndex))
            if not swallow: return 0
        return 1
    p = expat.ParserCreate(**kw)
    for n in HANDLERS: setattr(p, n, make(n))
    p.ExternalEntityRefHandler = external
    if default: setattr(p, default, make(default))
    p.SetParamEntityParsing(pe)
    if foreign is not None: p.UseForeignDTD(foreign)
    try:
        out.append(('result', feed(p, doc)))
    except expat.ExpatError as e:
        out.append(('ExpatError', str(e), e.code, p.ErrorLineNumber, p.ErrorColumnNumber, p.ErrorByteIndex))
    except BaseException as e:
        out.append((type(e).__name__, str(e)))
    for o in out: print(ascii(o))
    print('--')

def every(doc, files={}, **kw):
    print(doc, files, kw)
    parse(doc, files, **kw)
    parse(doc, files, chunks=1, **kw)
    parse(doc, files, default='DefaultHandler', **kw)
    parse(doc, files, default='DefaultHandlerExpand', chunks=3, **kw)

# ---- General entities
G = b'<!DOCTYPE a [<!ENTITY e SYSTEM "e.xml"><!ENTITY i "internal"><!ENTITY f SYSTEM "f.xml">]><a>x&e;y</a>'
for e in (b'', b'text', b'<b>t</b>', b'<b/>', b't<b c="d">u</b>v', b'&i;', b'&#65;&amp;', b'<![CDATA[<x>]]>', b'<!--c--><?p d?>', b'\n\r\n\r', b'a\r',
          b'<?xml version="1.0"?>t', b'<?xml encoding="iso-8859-1"?>\xe9', b'<?xml version="1.0" encoding="iso-8859-1"?>\xe9', b'<?xml version="1.0" encoding="utf-8" ?>\xc3\xa9',
          b'<?xml version="1.0" standalone="yes"?>t', b'<?xml?>', b'<?xml version="1.1"?>t', b'<?xml encoding="nope"?>t', b'<?xml encoding="cp1252"?>\x80', b' <?xml version="1.0"?>',
          b'\xef\xbb\xbft', b'\xef\xbb\xbf<?xml encoding="utf-8"?>t', '<?xml encoding="utf-16"?>t\xe9'.encode('utf-16'), 't\xe9'.encode('utf-16'), '<b/>'.encode('utf-16-le'), '<b/>'.encode('utf-16-be'), 't'.encode('utf-16-le'),
          b'<b>', b'</a>', b'</b>', b'<b></a>', b'<b></b></a><a>', b'<b', b'&', b'&x;', b'&e;', b'&f;', b'\xff', b'\xc3', b'a]]>b', b']', b']]', b'<![CDATA[x', b'<![CDATA[x]]', b'<!DOCTYPE b>', b'<?xml', b'<?xm', b'<', b'\x01', b'x\x00'):
    every(G, {'e.xml': e, 'f.xml': b'[&e;]'})
every(G, {'e.xml': b'[&f;]', 'f.xml': b'<g>&i;</g>'})
every(G, {})
every(G.replace(b'e.xml', b'fail.xml'), {})
every(G, {'e.xml': b'</a>'}, swallow=True)
every(G, {'e.xml': b'\xe9'}, encoding='iso-8859-1')
every(G, {'e.xml': b'<?xml encoding="utf-8"?>\xc3\xa9'}, encoding='iso-8859-1')
every(G, {'e.xml': 't'.encode('utf-16-le')}, encoding='utf-16')
every(G, {'e.xml': b'\xe9'}, encoding='nope')
every(b'<!DOCTYPE a [<!ENTITY e SYSTEM "e.xml">]><a b="&e;"/>', {'e.xml': b't'})
every(b'<!DOCTYPE a [<!ENTITY e PUBLIC "pub  id" "e.xml">]><a>&e;&e;</a>', {'e.xml': b't'})
every(b'<!DOCTYPE p:a [<!ENTITY e SYSTEM "e.xml">]><p:a xmlns:p="urn:p" xmlns="urn:d" xmlns:q="urn:q">&e;</p:a>', {'e.xml': b'<p:b q:c="1" d="2"><e xmlns:p="urn:p2"><p:f/></e></p:b><r:x/>'}, namespace_separator=' ')
every(b'<!DOCTYPE a [<!ENTITY e SYSTEM "e.xml">]><a xmlns:p="urn:p">&e;</a>', {'e.xml': b'<p:b/>'}, namespace_separator='')
every(b'<!DOCTYPE a [<!ENTITY e SYSTEM "e.xml">]><a xmlns:p="urn:p">&e;</a>', {'e.xml': b'<p:b/>'})

# ---- The external subset
def subset(dtd, doc=b'<!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>', **kw):
    files = {'a.dtd': dtd, 'p.ent': b'<!ENTITY e "from p">', 'q.ent': b'<?xml encoding="iso-8859-1"?><!ENTITY e "\xe9">', 'c.ent': b'(b, c)', 'bad.ent': b'<!ENTITY e "x"'}
    files.update(kw.pop('files', {}))
    every(doc, files, **kw)

for dtd in (b'', b'<!ENTITY e "v">', b'<?xml version="1.0" encoding="utf-8"?><!ENTITY e "v">', b'<?xml encoding="iso-8859-1"?><!ENTITY e "\xe9">', b'<?xml version="1.0"?><!ENTITY e "v">', b'<?xml encoding="utf-8" standalone="yes"?>',
            b'<!ELEMENT a (#PCDATA)><!ATTLIST a b CDATA "d" c ID #IMPLIED><!ENTITY e "v"><!NOTATION n SYSTEM "s"><!ENTITY u SYSTEM "x" NDATA n><!--c--><?p d?>',
            b'<![INCLUDE[<!ENTITY e "inc">]]>', b'<![IGNORE[<!ENTITY e "ign">]]><!ENTITY e "v">', b'<![ INCLUDE [<!ENTITY e "inc">]]>', b'<![\nIGNORE\n[ anything <!-- ]]><!ENTITY e "v">',
            b'<![INCLUDE[<![INCLUDE[<!ENTITY e "deep">]]>]]>', b'<![INCLUDE[<![IGNORE[<!ENTITY e "no">]]><!ENTITY e "yes">]]>', b'<![IGNORE[<![INCLUDE[<!ENTITY e "no">]]> still ]]><!ENTITY e "v">',
            b'<![IGNORE[<![IGNORE[ ]]> ]]> <!ENTITY e "v">', b'<![IGNORE[ ] ]] ]> <! <![ ]]> ]]><!ENTITY e "v">', b'<![IGNORE[]]><!ENTITY e "v">', b'<![INCLUDE[]]><!ENTITY e "v">',
            b'<!ENTITY % x "INCLUDE"><![%x;[<!ENTITY e "inc">]]>', b'<!ENTITY % x "IGNORE"><![%x;[<!ENTITY e "ign">]]><!ENTITY e "v">', b'<!ENTITY % x " INCLUDE "><![ %x; [<!ENTITY e "inc">]]>', b'<!ENTITY % x "INCLUDE["><![%x;<!ENTITY e "inc">]]>',
            b'<![INCLUDE[<!ENTITY e "v">', b'<![INCLUDE[<!ENTITY e "v">]]', b'<![INCLUDE[<!ENTITY e "v">]>', b'<![IGNORE[<!ENTITY e "v">', b'<![IGNORE[ ]]', b'<![IGNORE[ <![ ]]>', b'<![IGNORE[\xff]]>', b'<![IGNORE[\x01]]>', b'<![IGNORE[\xc3',
            b']]>', b'<!ENTITY e "v">]]>', b']', b'<![', b'<![INCLUDE', b'<![INCLUDE[', b'<![OTHER[]]>', b'<![include[]]>', b'<![INCLUDE x[]]>', b'<![CDATA[x]]>', b'<![INCLUDE[]]>]]>', b'<![%y;[]]>',
            b'<!ENTITY % c "(b, c)"><!ELEMENT a %c;><!ENTITY e "v">', b'<!ENTITY % c "b, c"><!ELEMENT a (%c;)><!ENTITY e "v">', b'<!ENTITY % c "b | c"><!ELEMENT a (x | %c; | y)*><!ENTITY e "v">', b'<!ENTITY % c "(b"><!ELEMENT a %c;)><!ENTITY e "v">',
            b'<!ENTITY % n "a"><!ELEMENT %n; EMPTY><!ATTLIST %n; x CDATA #IMPLIED><!ENTITY e "v">', b'<!ENTITY % t "CDATA"><!ATTLIST a x %t; "d"><!ENTITY e "v">', b'<!ENTITY % d "#IMPLIED"><!ATTLIST a x CDATA %d;><!ENTITY e "v">',
            b'<!ENTITY % d "\'dv\'"><!ATTLIST a x CDATA %d;><!ENTITY e "v">', b'<!ENTITY % a "x CDATA \'1\' y CDATA \'2\'"><!ATTLIST a %a;><!ENTITY e "v">', b'<!ENTITY % v "(p|q)"><!ATTLIST a x %v; "p"><!ENTITY e "v">',
            b'<!ENTITY % k "ENTITY"><!%k; e "v">', b'<!ENTITY % w "e \'v\'"><!ENTITY %w;>', b'<!ENTITY % s "SYSTEM \'x\'"><!ENTITY e2 %s;><!ENTITY e "v">', b'<!ENTITY % all "<!ENTITY e \'v\'>">%all;', b'<!ENTITY % half "<!ENTITY e ">%half; "v">',
            b'<!ENTITY % in "inner"><!ENTITY e "[%in;]">', b'<!ENTITY % in "&#37;x;"><!ENTITY % x "X"><!ENTITY e "[%in;]">', b'<!ENTITY % r "%r;"><!ENTITY e "v">%r;', b'<!ENTITY % r "<!ELEMENT a (%r;)>">%r;', b'<!ELEMENT a %undefined;><!ENTITY e "v">',
            b'%undefined;<!ENTITY e "v">', b'<!ENTITY % p SYSTEM "p.ent">%p;', b'<!ENTITY % q SYSTEM "q.ent">%q;', b'<!ENTITY % c SYSTEM "c.ent"><!ELEMENT a %c;><!ENTITY e "v">', b'<!ENTITY % bad SYSTEM "bad.ent">%bad;<!ENTITY e "v">',
            b'<!ENTITY % m SYSTEM "missing.ent">%m;<!ENTITY e "v">', b'<!ENTITY % m SYSTEM "fail.ent">%m;<!ENTITY e "v">', b'<!ENTITY e "v"', b'<!ENTITY e "v"> x', b'<a/>', b'<!DOCTYPE a>', b'\xef\xbb\xbf<!ENTITY e "v">', '<!ENTITY e "v\xe9">'.encode('utf-16'),
            b'<!ENTITY e "a&#38;b&lt;c">', b'<!ENTITY e "<b>&i;</b>"><!ENTITY i "I">', b'<!ENTITY e SYSTEM "e.xml">'):
    subset(dtd)
subset(b'<!ENTITY e "ext"><!ATTLIST a x CDATA "ext">', b'<!DOCTYPE a SYSTEM "a.dtd" [<!ENTITY e "int"><!ATTLIST a x CDATA "int" y CDATA "y">]><a>&e;</a>')
subset(b'<!ENTITY e "ext">', b'<?xml version="1.0" standalone="yes"?><!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>')
subset(b'<!ENTITY e "ext">', b'<?xml version="1.0" standalone="no"?><!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>')
subset(b'<!ENTITY e "ext">', b'<!DOCTYPE a PUBLIC "pub" "a.dtd"><a>&e;</a>')
subset(b'<!ENTITY e "ext">', pe=expat.XML_PARAM_ENTITY_PARSING_NEVER)
subset(b'<!ENTITY e "ext">', pe=expat.XML_PARAM_ENTITY_PARSING_UNLESS_STANDALONE)
subset(b'<!ENTITY e "ext">', b'<?xml version="1.0" standalone="yes"?><!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>', pe=expat.XML_PARAM_ENTITY_PARSING_UNLESS_STANDALONE)
subset(b'', b'<!DOCTYPE a [<!ENTITY % p SYSTEM "p.ent">%p;]><a>&e;</a>')
subset(b'', b'<!DOCTYPE a [<!ENTITY % p SYSTEM "p.ent">%p;]><a>&e;</a>', pe=expat.XML_PARAM_ENTITY_PARSING_NEVER)
subset(b'', b'<!DOCTYPE a [<!ENTITY % c "(b)"><!ELEMENT a %c;>]><a/>')
subset(b'', b'<!DOCTYPE a [<![INCLUDE[]]>]><a/>')
subset(b'', b'<!DOCTYPE a [<!ENTITY % i "<![INCLUDE[<!ENTITY e \'v\'>]]>">%i;]><a>&e;</a>')
subset(b'', b'<!DOCTYPE a [<!ENTITY % c "<!ENTITY &#37; d \'(b)\'><!ELEMENT a %d;>">%c;]><a/>')
subset(b'<!ENTITY % i "<![INCLUDE[<!ENTITY e \'v\'>]]>">%i;')
subset(b'<!ENTITY % i "<![IGNORE[<!ENTITY e \'w\'>]]><!ENTITY e \'v\'>">%i;')
subset(b'<!ENTITY % i "<![INCLUDE[">%i;<!ENTITY e "v">]]>')
subset(b'<!ENTITY % i "]]>"><![INCLUDE[<!ENTITY e "v">%i;')
subset(b'<!ENTITY % i "<![IGNORE[">%i; ]]><!ENTITY e "v">')
subset(b'<!ENTITY e "foreign">', b'<a>&e;</a>', foreign=True, files={None: b'<!ENTITY e "foreign">'})
subset(b'<!ENTITY e "foreign">', b'<!DOCTYPE a><a>&e;</a>', foreign=True, files={None: b'<!ENTITY e "foreign">'})
subset(b'<!ENTITY e "dtd">', b'<!DOCTYPE a SYSTEM "a.dtd"><a>&e;</a>', foreign=True, files={None: b'<!ENTITY e "foreign">'})
subset(b'<!ENTITY e "foreign">', b'<a>&e;</a>', foreign=False)
