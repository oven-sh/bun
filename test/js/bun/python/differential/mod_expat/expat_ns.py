import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from expat_common import *

docs = [
    b'<a xmlns="u"/>', b'<a xmlns="u"><b/></a>', b'<p:a xmlns:p="u"/>', b'<p:a xmlns:p="u" p:b="c" d="e"/>', b'<a xmlns="u" b="c"/>', b'<a xmlns="u"><b xmlns=""/><c/></a>', b'<a xmlns:p="u" xmlns:q="v"><p:b q:c="d"/></a>', b'<a xmlns:p="u"><b xmlns:p="v"><p:c/></b><p:d/></a>',
    b'<a xml:lang="en"/>', b'<a xmlns:xml="http://www.w3.org/XML/1998/namespace" xml:b="c"/>', b'<a xmlns:xml="u"/>', b'<a xmlns:p="http://www.w3.org/XML/1998/namespace"/>', b'<a xmlns="http://www.w3.org/XML/1998/namespace"/>', b'<a xmlns:xmlns="u"/>', b'<a xmlns:xmlns="http://www.w3.org/2000/xmlns/"/>',
    b'<a xmlns:p="http://www.w3.org/2000/xmlns/"/>', b'<a xmlns="http://www.w3.org/2000/xmlns/"/>', b'<a xmlns:p=""/>', b'<a xmlns=""/>', b'<p:a/>', b'<a p:b="c"/>', b'<a xmlns:p="u" xmlns:q="u" p:b="1" q:b="2"/>', b'<a xmlns:p="u" p:b="1" b="2"/>', b'<a xmlns="u" xmlns="v"/>', b'<a xmlns:p="u" xmlns:p="v"/>',
    b'<a:b:c xmlns:a="u"/>', b'<:a/>', b'<a:/>', b'<a: b="c"/>', b'<a b:c:d="e"/>', b'<a :b="c"/>', b'<a b:="c"/>', b'<a:1 xmlns:a="u"/>', b'<a><?p:i x?></a>', b'<!DOCTYPE a [<!ENTITY p:e "v">]><a/>', b'<a>&p:e;</a>', b'<p:a xmlns:p="u"></p:a>', b'<p:a xmlns:p="u"></a>', b'<p:a xmlns:p="u" xmlns:q="u"></q:a>',
    b'<a xmlns:p="u v"/>', b'<a xmlns="u v"><b/></a>', b'<a xmlns:p="u}v"><p:b/></a>', b'<a xmlns:p="u|v"><p:b/></a>', b'<a xmlns:p="&#38;&lt;"><p:b/></a>', '<a xmlns:p="\u00e9"><p:b/></a>'.encode(), '<\u00e9:a xmlns:\u00e9="u"/>'.encode(),
    b'<!DOCTYPE a [<!ATTLIST a xmlns CDATA "u" xmlns:p CDATA "v" p:b CDATA "d">]><a/>', b'<!DOCTYPE p:a [<!ATTLIST p:a xmlns:p CDATA "v">]><p:a/>', b'<!DOCTYPE a [<!ATTLIST a p:b CDATA "d">]><a/>', b'<!DOCTYPE a [<!ATTLIST a xmlns:p CDATA "v">]><a xmlns:p="w"><p:b/></a>',
    b'<!DOCTYPE a [<!ELEMENT p:a (p:b, q:c*)><!ATTLIST p:a q:r (x:y|z) "z">]><a/>', b'<!DOCTYPE a:b:c><a/>', b'<!DOCTYPE a [<!ELEMENT a:b:c EMPTY>]><a/>', b'<a xmlns:a="1" xmlns:b="2" xmlns:c="3"><b/></a>', b'<a xmlns="u" xmlns:p="v"/>',
]
for d in docs:
    print(d)
    for sep in (' ', '}', '|', '', '\n', 'x'):
        run(d, namespace_separator=sep)
    run(d, namespace_separator=' ', setup=lambda p: setattr(p, 'namespace_prefixes', True))
    run(d, namespace_separator='', setup=lambda p: setattr(p, 'namespace_prefixes', True))
    run(d, namespace_separator=' ', positions=True, setup=lambda p: setattr(p, 'ordered_attributes', True))
    run(d, namespace_separator=' ', handlers=[], default='DefaultHandler')
    run(d, namespace_separator=' ', handlers=['StartElementHandler', 'EndElementHandler'])
    run(d, namespace_separator=None)
    run(d)
