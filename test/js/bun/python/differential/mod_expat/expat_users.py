# The modules of the standard library that are built on pyexpat.
import io, sys
import xml.etree.ElementTree as ET
import xml.dom.minidom as minidom
import xml.sax, xml.sax.handler, xml.sax.saxutils
import plistlib, xmlrpc.client, datetime
from xml.dom import pulldom

def show(f, *a, **k):
    try:
        r = f(*a, **k)
        print(ascii(r))
    except BaseException as e:
        print(type(e).__name__, ascii(str(e)))

doc = '''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE root [<!ENTITY e "ent"><!ATTLIST item kind CDATA "def">]>
<!-- top -->
<root xmlns="urn:d" xmlns:p="urn:p" a="1">
  <item id="1">text &e; &amp; <b>bold</b> tail</item>
  <p:item p:x="y"><![CDATA[<raw>]]></p:item>
  <?pi data?>
  <empty/>é\U0001f600
</root>'''

# ElementTree
root = ET.fromstring(doc)
def dump(e, depth=0):
    print('  ' * depth, ascii((e.tag, sorted(e.attrib.items()), e.text, e.tail)))
    for c in e: dump(c, depth + 1)
dump(root)
print(ascii(ET.tostring(root, encoding='unicode')))
print(ET.tostring(root)[:80])
print([e.tag for e in root.iter()], root.find('{urn:d}item').get('kind'), root.findall('.//{urn:d}b')[0].text, root.findtext('{urn:p}item'))
tree = ET.parse(io.BytesIO(doc.encode())); print(tree.getroot().tag)
tree = ET.parse(io.StringIO(doc)); print(tree.getroot().tag)
print([(ev, str(getattr(el, 'tag', el)).split(' at ')[0]) for ev, el in ET.iterparse(io.BytesIO(doc.encode()), events=('start', 'end', 'start-ns', 'end-ns', 'comment', 'pi'))])
pp = ET.XMLPullParser(['start', 'end'])
for i in range(0, len(doc), 7): pp.feed(doc[i:i + 7])
pp.close(); print([(ev, el.tag) for ev, el in pp.read_events()])
pp = ET.XMLPullParser(['end']); pp.feed('<a><b/>'); pp.flush(); print([(ev, el.tag) for ev, el in pp.read_events()]); pp.feed('</a>'); pp.close(); print([(ev, el.tag) for ev, el in pp.read_events()])
for bad in ('', '<a>', '<a></b>', '<a>&x;</a>', '<a b="1" b="2"/>', '<a/><b/>', 'x', '<a>\x01</a>', '<!DOCTYPE a SYSTEM "x"><a>&nbsp;</a>', '<p:a/>'):
    try: ET.fromstring(bad); print('ok')
    except ET.ParseError as e: print('ParseError', e, e.code, e.position)
class T:
    def start(self, tag, attrib): print('start', tag, attrib)
    def end(self, tag): print('end', tag)
    def data(self, d): print('data', ascii(d))
    def comment(self, c): print('comment', c)
    def pi(self, t, d): print('pi', t, d)
    def doctype(self, name, pubid, system): print('doctype', name, pubid, system)
    def start_ns(self, p, u): print('start_ns', p, u)
    def end_ns(self, p): print('end_ns', p)
    def close(self): return 'closed'
p = ET.XMLParser(target=T()); p.feed('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0//EN" "http://x/y.dtd"><!--c--><html xmlns="u"><?p d?>tu</html>'); print(p.close())
p = ET.XMLParser(); p.entity['nbsp'] = '\xa0'; p.feed('<!DOCTYPE a SYSTEM "x"><a>&nbsp;</a>'); print(ascii(p.close().text))
print(ET.fromstring('<?xml version="1.0" encoding="iso-8859-1"?><a>\xe9</a>'.encode('latin-1')).text == '\xe9', ET.fromstring('<a>中</a>'.encode('utf-16')).text == '中', ET.fromstring('<?xml version="1.0" encoding="cp1252"?><a>\x80</a>'.encode('latin-1')).text == '€')
print(ET.canonicalize('<a  b="1"   a="2"><c/>\n</a>'))
big = ET.Element('r')
for i in range(300): ET.SubElement(big, 'c', n=str(i)).text = 'v%d' % i
print(len(ET.fromstring(ET.tostring(big))), ET.fromstring(ET.tostring(big))[299].text)

# minidom
d = minidom.parseString(doc)
print(ascii(d.toxml()))
print(d.documentElement.tagName, d.documentElement.namespaceURI, d.doctype.name, [(n.nodeName, n.nodeType) for n in d.childNodes], [e.nodeName for e in d.doctype.entities.values()] if hasattr(d.doctype.entities, 'values') else d.doctype.entities.length)
it = d.getElementsByTagName('item')[0]; print(it.getAttribute('id'), it.getAttribute('kind'), it.getAttributeNode('kind'), ascii(it.firstChild.data), [c.nodeType for c in it.childNodes])
print(d.getElementsByTagNameNS('urn:p', 'item')[0].firstChild.nodeType, d.getElementsByTagNameNS('urn:p', 'item')[0].getAttributeNS('urn:p', 'x'))
print(ascii(minidom.parseString('<a><b c="d">e</b><!--f--></a>').toprettyxml(indent=' ')))
print(minidom.parse(io.BytesIO(b'<a>x</a>')).documentElement.firstChild.data)
show(minidom.parseString, '<a>'); show(minidom.parseString, ''); show(minidom.parseString, '<a>&x;</a>')
d.unlink()

# sax
class H(xml.sax.handler.ContentHandler):
    def setDocumentLocator(self, l): self.l = l
    def startDocument(self): print('startDocument')
    def endDocument(self): print('endDocument')
    def startElement(self, n, a): print('startElement', n, sorted(a.items()), self.l.getLineNumber() if hasattr(self, 'l') else None, self.l.getColumnNumber() if hasattr(self, 'l') else None)
    def endElement(self, n): print('endElement', n)
    def startElementNS(self, n, q, a): print('startElementNS', n, q, sorted((k, v, a.getQNameByName(k)) for k, v in a.items()))
    def endElementNS(self, n, q): print('endElementNS', n, q)
    def startPrefixMapping(self, p, u): print('startPrefixMapping', p, u)
    def endPrefixMapping(self, p): print('endPrefixMapping', p)
    def characters(self, c): print('characters', ascii(c))
    def ignorableWhitespace(self, c): print('ignorable', ascii(c))
    def processingInstruction(self, t, d): print('pi', t, d)
    def skippedEntity(self, n): print('skipped', n)
xml.sax.parseString(doc.encode(), H())
r = xml.sax.make_parser(); r.setContentHandler(H()); r.setFeature(xml.sax.handler.feature_namespaces, True); r.parse(io.BytesIO(doc.encode()))
r = xml.sax.make_parser(); r.setContentHandler(H()); r.feed('<a>'); r.feed('x</a>'); r.close()
for bad in (b'<a>', b'<a></b>', b'', b'<a>&x;</a>'):
    try: xml.sax.parseString(bad, xml.sax.handler.ContentHandler())
    except xml.sax.SAXParseException as e: print('SAXParseException', e.getMessage(), e.getLineNumber(), e.getColumnNumber())
class LH:
    def comment(self, c): print('comment', c)
    def startDTD(self, n, p, s): print('startDTD', n, p, s)
    def endDTD(self): print('endDTD')
    def startCDATA(self): print('startCDATA')
    def endCDATA(self): print('endCDATA')
    def startEntity(self, n): print('startEntity', n)
    def endEntity(self, n): print('endEntity', n)
class DH(xml.sax.handler.DTDHandler):
    def notationDecl(self, *a): print('notationDecl', a)
    def unparsedEntityDecl(self, *a): print('unparsedEntityDecl', a)
r = xml.sax.make_parser(); r.setProperty(xml.sax.handler.property_lexical_handler, LH()); r.setDTDHandler(DH())
r.parse(io.BytesIO(b'<!DOCTYPE a PUBLIC "p" "s" [<!NOTATION n SYSTEM "x"><!ENTITY u SYSTEM "y" NDATA n>]><a><!--c--><![CDATA[d]]></a>'))
o = io.StringIO(); g = xml.sax.saxutils.XMLGenerator(o, 'utf-8'); xml.sax.parseString(b'<a b="c&amp;">d&lt;<e/></a>', g); print(o.getvalue())

# pulldom
print([(ev, n.nodeName) for ev, n in pulldom.parseString('<a><b>c</b></a>')])

# plistlib
v = {'s': 'stré', 'i': 5, 'f': 1.5, 'b': True, 'd': b'bytes', 'l': [1, 'two', {'x': None and 0 or 3}], 'date': datetime.datetime(2020, 1, 2, 3, 4, 5), 'n': {'deep': []}}
x = plistlib.dumps(v); print(plistlib.loads(x) == v, x[:60]); print(plistlib.load(io.BytesIO(x)) == v)
show(plistlib.loads, b'<plist><dict><key>a</key></dict></plist>'); show(plistlib.loads, b'<!DOCTYPE p [<!ENTITY e "x">]><plist><string>&e;</string></plist>'); show(plistlib.loads, b'<plist>')

# xmlrpc
m = xmlrpc.client.dumps((1, 'twoé', 3.5, [True, None and 1 or 2], {'k': b'v'}, datetime.datetime(2020, 1, 2)), 'meth'); print(ascii(xmlrpc.client.loads(m, use_builtin_types=True)))
m = xmlrpc.client.dumps(xmlrpc.client.Fault(3, 'oops')); show(xmlrpc.client.loads, m)
print(xmlrpc.client.getparser()[0].__class__.__name__)
