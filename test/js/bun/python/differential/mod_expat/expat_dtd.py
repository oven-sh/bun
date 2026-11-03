import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from expat_common import *

docs = [
    b'<!DOCTYPE a><a/>', b'<!DOCTYPE a []><a/>', b'<!DOCTYPE a [ ]>\n<a/>', b'<!DOCTYPE a SYSTEM "s.dtd"><a/>', b'<!DOCTYPE a PUBLIC "-//P//EN" "s.dtd"><a/>', b'<!DOCTYPE a PUBLIC " -//P \n //EN " \'s.dtd\' [ ] ><a/>', b'<!DOCTYPE a:b SYSTEM "s"><a:b/>',
    b'<!DOCTYPE a [<!ENTITY e "v">]><a>&e;</a>', b'<!DOCTYPE a [<!ENTITY e "v"><!ENTITY e "w">]><a>&e;</a>', b'<!DOCTYPE a [<!ENTITY e "x&#38;#60;y">]><a>[&e;]</a>', b'<!DOCTYPE a [<!ENTITY e "<b>t</b>">]><a>&e;&e;</a>',
    b'<!DOCTYPE a [<!ENTITY e "1&f;2"><!ENTITY f "F">]><a>&e;</a>', b'<!DOCTYPE a [<!ENTITY e "&e;">]><a>&e;</a>', b'<!DOCTYPE a [<!ENTITY e "&f;"><!ENTITY f "&e;">]><a>&e;</a>', b'<!DOCTYPE a [<!ENTITY e "<b>">]><a>&e;</b></a>', b'<!DOCTYPE a [<!ENTITY e "</a>">]><a>&e;',
    b'<!DOCTYPE a [<!ENTITY e "v">]><a b="&e;"/>', b'<!DOCTYPE a [<!ENTITY e "a&#10;b\nc">]><a b="&e;">&e;</a>', b'<!DOCTYPE a [<!ENTITY e "<">]><a b="&e;"/>', b'<!DOCTYPE a [<!ENTITY e "&#60;">]><a b="&e;"/>', b'<!DOCTYPE a [<!ENTITY e "&e;">]><a b="&e;"/>',
    b'<!DOCTYPE a [<!ENTITY e SYSTEM "x.ent">]><a>&e;</a>', b'<!DOCTYPE a [<!ENTITY e SYSTEM "x.ent">]><a b="&e;"/>', b'<!DOCTYPE a [<!ENTITY e PUBLIC "pub" "x.ent">]><a>&e;</a>', b'<!DOCTYPE a [<!NOTATION n SYSTEM "n.exe"><!ENTITY e SYSTEM "x.gif" NDATA n>]><a>&e;</a>',
    b'<!DOCTYPE a [<!NOTATION n SYSTEM "n.exe"><!ENTITY e SYSTEM "x.gif" NDATA n>]><a b="&e;"/>', b'<!DOCTYPE a [<!NOTATION n PUBLIC "pub"><!NOTATION m PUBLIC "pub2" "sys">]><a/>', b'<!DOCTYPE a [<!ENTITY % p "v"><!ENTITY % q SYSTEM "q.ent">]><a/>',
    b'<!DOCTYPE a [<!ENTITY % p "<!ENTITY e \'v\'>">%p;]><a>&e;</a>', b'<!DOCTYPE a [<!ENTITY % p "x"><!ENTITY e "%p;">]><a/>', b'<!DOCTYPE a [%u;<!ENTITY e "v">]><a>&e;&z;</a>', b'<!DOCTYPE a SYSTEM "s"><a>&z;</a>', b'<!DOCTYPE a SYSTEM "s"><a b="&z;"/>',
    b'<?xml version="1.0" standalone="yes"?><!DOCTYPE a SYSTEM "s"><a>&z;</a>', b'<?xml version="1.0" standalone="no"?><!DOCTYPE a SYSTEM "s"><a>&z;</a>', b'<!DOCTYPE a [<!ENTITY lt "x"><!ENTITY amp "&#38;#38;">]><a>&lt;&amp;</a>',
    b'<!DOCTYPE a [<!ELEMENT a EMPTY>]><a/>', b'<!DOCTYPE a [<!ELEMENT a ANY>]><a/>', b'<!DOCTYPE a [<!ELEMENT a (#PCDATA)>]><a/>', b'<!DOCTYPE a [<!ELEMENT a (#PCDATA)*>]><a/>', b'<!DOCTYPE a [<!ELEMENT a (#PCDATA|b|c)*>]><a/>', b'<!DOCTYPE a [<!ELEMENT a (b)>]><a/>',
    b'<!DOCTYPE a [<!ELEMENT a (b,c)>]><a/>', b'<!DOCTYPE a [<!ELEMENT a (b|c)>]><a/>', b'<!DOCTYPE a [<!ELEMENT a (b?,c*,d+)>]><a/>', b'<!DOCTYPE a [<!ELEMENT a ((b,c)|(d,e))*>]><a/>', b'<!DOCTYPE a [<!ELEMENT a (b,(c|d)+,e?)?>]><a/>', b'<!DOCTYPE a [<!ELEMENT a ( b , ( c | d ) ) >]><a/>',
    b'<!DOCTYPE a [<!ELEMENT a (((b)))>]><a/>', b'<!DOCTYPE a [<!ELEMENT a (b,c|d)>]><a/>', b'<!DOCTYPE a [<!ELEMENT a (b|c,d)>]><a/>', b'<!DOCTYPE a [<!ELEMENT a ()>]><a/>', b'<!DOCTYPE a [<!ELEMENT a (#PCDATA|b)>]><a/>', b'<!DOCTYPE a [<!ELEMENT a (b,#PCDATA)>]><a/>', b'<!DOCTYPE a [<!ELEMENT a b>]><a/>',
    b'<!DOCTYPE a [<!ELEMENT a (b>]><a/>', b'<!DOCTYPE a [<!ELEMENT a (b))>]><a/>', b'<!DOCTYPE a [<!ELEMENT a>]><a/>', b'<!DOCTYPE a [<!ELEMENT (b)>]><a/>', b'<!DOCTYPE a [<!ELEMENT a (b)x>]><a/>', b'<!DOCTYPE a [<!ELEMENT a (b) *>]><a/>', b'<!DOCTYPE a [<!ELEMENT x:a (x:b)>]><a/>',
    b'<!DOCTYPE a [<!ATTLIST a b CDATA #IMPLIED>]><a/>', b'<!DOCTYPE a [<!ATTLIST a b CDATA #REQUIRED>]><a/>', b'<!DOCTYPE a [<!ATTLIST a b CDATA "d">]><a/>', b'<!DOCTYPE a [<!ATTLIST a b CDATA #FIXED "d">]><a/>', b'<!DOCTYPE a [<!ATTLIST a b CDATA "d">]><a b="x"/>',
    b'<!DOCTYPE a [<!ATTLIST a b CDATA "d" c CDATA "e">]><a c="x"/>', b'<!DOCTYPE a [<!ATTLIST a b CDATA "d"><!ATTLIST a b CDATA "e" c CDATA "f">]><a/>', b'<!DOCTYPE a [<!ATTLIST a b ID #IMPLIED c IDREF #IMPLIED d IDREFS #IMPLIED e ENTITY #IMPLIED f ENTITIES #IMPLIED g NMTOKEN #IMPLIED h NMTOKENS #IMPLIED>]><a/>',
    b'<!DOCTYPE a [<!ATTLIST a b (x|y|z) "x">]><a/>', b'<!DOCTYPE a [<!ATTLIST a b ( x | y ) #IMPLIED>]><a/>', b'<!DOCTYPE a [<!ATTLIST a b NOTATION (x|y) #IMPLIED>]><a/>', b'<!DOCTYPE a [<!ATTLIST a b (1|2) "1">]><a/>', b'<!DOCTYPE a [<!ATTLIST a>]><a/>',
    b'<!DOCTYPE a [<!ATTLIST a b NMTOKENS "  x   y  ">]><a/>', b'<!DOCTYPE a [<!ATTLIST a b NMTOKENS #IMPLIED>]><a b="  x \n  y&#32;&#32;z  "/>', b'<!DOCTYPE a [<!ATTLIST a b CDATA #IMPLIED>]><a b="  x \n  y  "/>', b'<!DOCTYPE a [<!ATTLIST a b ID #IMPLIED>]><a b=" i "/>',
    b'<!DOCTYPE a [<!ENTITY e "v"><!ATTLIST a b CDATA "[&e;&#65;&lt;]">]><a/>', b'<!DOCTYPE a [<!ATTLIST a b CDATA "&u;">]><a/>', b'<!DOCTYPE a [<!ATTLIST a b CDATA "<">]><a/>', b'<!DOCTYPE a [<!ATTLIST a b FOO #IMPLIED>]><a/>', b'<!DOCTYPE a [<!ATTLIST a b CDATA #FOO>]><a/>', b'<!DOCTYPE a [<!ATTLIST a b CDATA>]><a/>',
    b'<!DOCTYPE a [<!ATTLIST a b CDATA #FIXED>]><a/>', b'<!DOCTYPE a [<!ATTLIST a b (x,y) "x">]><a/>', b'<!DOCTYPE a [<!ATTLIST a b () "x">]><a/>', b'<!DOCTYPE a [<!ATTLIST b c CDATA "d">]><a><b/><b c="e"/></a>',
    b'<!DOCTYPE a [<!-- c --><?pi d?>]><a/>', b'<!DOCTYPE a [<?xml version="1.0"?>]><a/>', b'<!DOCTYPE a [x]><a/>', b'<!DOCTYPE a [<a/>]><a/>', b'<!DOCTYPE a [<!FOO>]><a/>', b'<!DOCTYPE a [<!ENTITY>]><a/>', b'<!DOCTYPE a [<!ENTITY e>]><a/>', b'<!DOCTYPE a [<!ENTITY e v>]><a/>',
    b'<!DOCTYPE a [<!ENTITY e "v" x>]><a/>', b'<!ENTITY e "v"><a/>', b'<!DOCTYPE a [<!ENTITY e "v"', b'<!DOCTYPE a [<!ENTITY e "v">', b'<!DOCTYPE a [<!ENTITY e "v">]', b'<!DOCTYPE a [<!ENTITY e "v">]>', b'<!DOCTYPE a [<!ENTITY e "&">]><a/>', b'<!DOCTYPE a [<!ENTITY e "&#0;">]><a/>', b'<!DOCTYPE a [<!ENTITY e "%">]><a/>',
    b'<!DOCTYPE a [<!ENTITY e "% x">]><a/>', b'<!DOCTYPE a [<!ENTITY e "a\r\nb\rc">]><a>&e;</a>', b'<!DOCTYPE a [<!ENTITY e SYSTEM>]><a/>', b'<!DOCTYPE a [<!ENTITY e PUBLIC "p">]><a/>', b'<!DOCTYPE a [<!ENTITY e PUBLIC "{" "s">]><a/>', b'<!DOCTYPE a PUBLIC "{" "s"><a/>', b'<!DOCTYPE a [<!NOTATION n PUBLIC "{">]><a/>',
    b'<!DOCTYPE a [<!ENTITY % p SYSTEM "x" NDATA n>]><a/>', b'<!DOCTYPE a [<!ENTITY e SYSTEM "x" NDATA>]><a/>', b'<!DOCTYPE a [<!ENTITY%p "x">]><a/>', b'<!DOCTYPE a [<!ENTITY %p "x">]><a/>', b'<!DOCTYPE a [<!ENTITY % p"x">]><a/>', b'<!DOCTYPE a [<!ENTITY e"x">]><a/>', b'<!DOCTYPE a [<!ENTITY e "x""y">]><a/>',
    b'<!DOCTYPE a [<![INCLUDE[]]>]><a/>', b'<!DOCTYPE a []]><a/>', b'<!DOCTYPE a [] x><a/>', b'<!DOCTYPE a SYSTEM><a/>', b'<!DOCTYPE a PUBLIC "p"><a/>', b'<!DOCTYPE a SYSTEM "s" "t"><a/>', b'<!DOCTYPE a SYSTEM s><a/>', b'<!DOCTYPE 1a><a/>', b'<!DOCTYPE a[]><a/>', b'<!DOCTYPE a\r\n[\r\n]\r\n>\r\n<a/>',
    b'<!DOCTYPE a [<!ENTITY e "<?pi x?><!--c--><![CDATA[d]]>&#65;&amp;">]><a>&e;</a>', b'<!DOCTYPE a [<!ENTITY e "x<">]><a>&e;</a>', b'<!DOCTYPE a [<!ENTITY e "x&">]><a>&e;</a>', b'<!DOCTYPE a [<!ENTITY e "x&z;">]><a>&e;</a>', b'<!DOCTYPE a [<!ENTITY e "<?xml version=\'1.0\'?>">]><a>&e;</a>', b'<!DOCTYPE a [<!ENTITY e "]]&#62;">]><a>&e;</a>',
    b'<!DOCTYPE a [<!ENTITY e "">]><a>[&e;]</a>', b'<!DOCTYPE a [<!ENTITY e "x\ny">]>\n<a>\n &e;\n <b c="&e;"/></a>',
]
for d in docs:
    print(d)
    run(d)
    run(d, positions=True)
    run(d, handlers=[], default='DefaultHandler')
    run(d, handlers=[], default='DefaultHandlerExpand')
    run(d, handlers=['StartElementHandler', 'CharacterDataHandler'], default='DefaultHandler')
    run(d, handlers=['StartDoctypeDeclHandler', 'EntityDeclHandler'], default='DefaultHandlerExpand')
    run(d, handlers=['ElementDeclHandler', 'AttlistDeclHandler', 'NotationDeclHandler', 'EndDoctypeDeclHandler'], default='DefaultHandler')
    run(d, chunks=1, setup=lambda p: p.SetReparseDeferralEnabled(False))
    run(d, chunks=3, handlers=[], default='DefaultHandler', setup=lambda p: p.SetReparseDeferralEnabled(False))
    run(d, setup=lambda p: (setattr(p, 'ordered_attributes', True), setattr(p, 'specified_attributes', True), p.SetBase('base/')))
    run(d, setup=lambda p: p.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_ALWAYS))
