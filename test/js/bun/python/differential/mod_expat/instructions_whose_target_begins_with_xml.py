# <?xml-stylesheet ...?> at the very start of a document is a processing instruction, not a declaration.
import pyexpat
import xml.dom.minidom
import xml.etree.ElementTree as ET

documents = [
    '<?xml-stylesheet href="a" type="text/xsl"?><r/>', '<?xmlfoo bar?><r/>', '<?xml-s a?>\n<r>t</r>', ' <?xml-s a?><r/>', '<!--c--><?xml-s a?><r/>',
    '<?xml version="1.0"?><?xml-s a?><r/>', '<r><?xml-x y?></r>', '<?XML a?><r/>', '<?xml?><r/>', '<?xm l?><r/>', '<?xml\tversion="1.0"?><r/>',
    '<?xml\nversion="1.0" encoding="latin-1"?><r>\xe9</r>', '<?xml-s a?><r>\xe9</r>', '<?xml.a?><r/>', '<?xml:a b?><r/>', '<?xmlé a?><r/>', '<?xml', '<?xml-', '<?xml-s a?>',
    '﻿<?xml-s a?><r/>',
]


def events(feed):
    parser = pyexpat.ParserCreate()
    seen = []
    parser.ProcessingInstructionHandler = lambda target, data: seen.append(("instruction", target, data))
    parser.StartElementHandler = lambda name, attributes: seen.append(("start", name))
    parser.CharacterDataHandler = lambda data: seen.append(("text", data))
    parser.XmlDeclHandler = lambda *arguments: seen.append(("declaration", arguments))
    try:
        feed(parser)
    except pyexpat.ExpatError as e:
        seen.append(str(e))
    return seen


for document in documents:
    print(ascii(document))
    print("   str    ", ascii(events(lambda parser: parser.Parse(document, True))))
    for encoding in ("utf-8", "utf-16", "latin-1"):
        if "encoding=" in document and encoding != "latin-1":
            continue
        try:
            data = document.encode(encoding)
        except UnicodeEncodeError:
            continue
        print("  ", encoding, ascii(events(lambda parser: parser.Parse(data, True))))

        def byte_by_byte(parser):
            for i in range(len(data)):
                parser.Parse(data[i:i + 1], False)
            parser.Parse(b"", True)
        print("  ", encoding, "byte by byte", ascii(events(byte_by_byte)))

print(xml.dom.minidom.parseString(documents[0]).toxml())
print(ET.tostring(ET.fromstring(documents[0])))
