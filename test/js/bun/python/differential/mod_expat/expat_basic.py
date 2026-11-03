import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from expat_common import *

docs = [
    b'<a/>', b'<a></a>', b'<a>text</a>', b'<a b="c"/>', b'<a b="c" d=\'e\'>x</a>', b'<a><b/><c>t</c></a>', b'<?xml version="1.0"?><a/>', b'<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<a/>',
    b'<a>1\n2\r\n3\r4</a>', b'<a>&lt;&gt;&amp;&quot;&apos;</a>', b'<a>&#65;&#x42;&#x1F600;</a>', b'<a><!-- c --><?pi data?><?pi2?></a>', b'<!-- before --><a/><!-- after --><?pi?>\n', b'<a><![CDATA[x<y]]>z</a>',
    b'<a><![CDATA[]]></a>', b'<a><![CDATA[a]b]]c\nd\r\ne]]></a>', b'<a>]</a>', b'<a>]]</a>', b'<a>a]b]]c</a>', b'  \n <a/>  \n', b'<a  b = "c"  />', b'<a\nb="c"\n>\n</a\n>', '<a>é中\U0001f600</a>'.encode(), '<é 中="\U0001f600"/>'.encode(),
    b'<a b="1&#10;2&#9;3 \n\t4&amp;&lt;"/>', b'<a b="  x  y  "/>', b'<a><b><c><d/></c></b></a>', b'<a:b xmlns:a="u"/>', b'<a.b-c_d/>', b'<_a/>', b'<a b=""/>',
]
for d in docs:
    print(d)
    run(d)
    run(d, positions=True)
    run(d, handlers=[], default='DefaultHandler')
    run(d, chunks=1, setup=lambda p: p.SetReparseDeferralEnabled(False))
    run(d, setup=lambda p: setattr(p, 'buffer_text', True))
    run(d, setup=lambda p: (setattr(p, 'ordered_attributes', True), setattr(p, 'specified_attributes', True)))

bad = [
    b'', b' ', b'\n\n', b'<', b'<a', b'<a>', b'<a><b>', b'<a></b>', b'<a></a', b'<a></a><b/>', b'<a/>x', b'x<a/>', b'<a/><', b'<a/>&amp;', b'<a b/>', b'<a b=/>', b'<a b=c/>', b'<a b="c/>', b'<a b="c"d="e"/>', b'<a b="c" b="d"/>',
    b'<a b="<"/>', b'<a b="&"/>', b'<a b="&x;"/>', b'<a b="&#0;"/>', b'<a>&</a>', b'<a>&x</a>', b'<a>&x;</a>', b'<a>&;</a>', b'<a>&#;</a>', b'<a>&#x;</a>', b'<a>&#0;</a>', b'<a>&#xD800;</a>', b'<a>&#x110000;</a>', b'<a>&#xFFFE;</a>', b'<a>&#1;</a>',
    b'<a>]]></a>', b'<a>x]]></a>', b'<a><!-- -- --></a>', b'<a><!-- x', b'<a><!- x --></a>', b'<a><!x></a>', b'<a><![CDATA[x</a>', b'<a><![CDATX[x]]></a>', b'<a><![CDA', b'<a><?pi</a>', b'<a><??></a>', b'<a><?xml version="1.0"?></a>', b'<a><?XML x?></a>', b'<a><?xMl?></a>',
    b' <?xml version="1.0"?><a/>', b'<?xml?><a/>', b'<?xml version?><a/>', b'<?xml version=1.0?><a/>', b'<?xml version="1.0" foo="x"?><a/>', b'<?xml encoding="utf-8"?><a/>', b'<?xml version="1.0" standalone="maybe"?><a/>', b'<?xml version="1.0" encoding=""?><a/>',
    b'<?xml version="1.0" encoding="1x"?><a/>', b'<?xml version="1.0"encoding="utf-8"?><a/>', b'<?xml version="1.0" standalone="yes" encoding="utf-8"?><a/>', b'<?xml version="1.0" ?x><a/>', b'<?xml version="1.0', b'<?xml version="a b"?><a/>', b'<?xml  version = "1.0"  ?><a/>',
    b'<1a/>', b'<-a/>', b'< a/>', b'<a/ >', b'<a//>', b'</a>', b'<a></ a>', b'<a></a b>', b'<a>\x00</a>', b'<a>\x01</a>', b'<a>\x1f</a>', b'<a b="\x01"/>', b'<a>\xff</a>', b'<a>\xc3</a>', b'<a>\xc3', b'<a>\xe4\xb8', b'<a>\xc0\x80</a>', b'<a>\xed\xa0\x80</a>',
    b'<a>\xef\xbf\xbe</a>', b'<a>\xef\xbf\xbf</a>', b'<a>\xf4\x90\x80\x80</a>', b'<a>\xf0\x9f\x98</a>', b'<\xf0\x9f\x98\x80/>', b'<a \xf0\x9f\x98\x80="x"/>', b'<a>\n\n  <b>\n</c></a>', b'<a>\r\n\r\n x &y; </a>', b'<a>\xc3\xa9\xc3\xa9&y;</a>', b'<a>\xf0\x9f\x98\x80&y;</a>',
    b'<a><b></a></b>', b'<a>x', b'<a>x\r', b'<a>x]', b'<a>x]]', b'<a/>\r', b'<a/> \r', b'<a/><!--', b'<a/><?x', b'<a/>]', b'<a/><![CDATA[x]]>', b'<a/><!DOCTYPE a>', b'<!DOCTYPE a><!DOCTYPE a><a/>', b'<!DOCTYPE>', b'<!DOCTYPE a', b'<!DOCTYPE a>', b'<!DOCTYPE a x><a/>', b'<!FOO a><a/>', b'<!doctype a><a/>',
]
for d in bad:
    print(d)
    run(d)
    run(d, chunks=1, setup=lambda p: p.SetReparseDeferralEnabled(False))
    run(d, handlers=[], default='DefaultHandlerExpand')
