# In what pieces long stretches of text are reported: it depends on the encoding of the input.
from xml.parsers import expat

def pieces(data, buffer_text=False, buffer_size=None, default=False, feed=None):
    p = expat.ParserCreate()
    out = []
    def chars(d): out.append((len(d), d[:1], d[-1:], p.CurrentLineNumber, p.CurrentColumnNumber, p.CurrentByteIndex))
    if default: p.DefaultHandler = chars
    else: p.CharacterDataHandler = chars
    p.buffer_text = buffer_text
    if buffer_size: p.buffer_size = buffer_size
    try:
        if feed:
            for i in range(0, len(data), feed): p.Parse(data[i:i + feed], False)
            p.Parse(b'', True)
        else:
            p.Parse(data, True)
    except expat.ExpatError as e:
        out.append(str(e))
    return ascii(out)

encodings = [('utf-8', 'utf-8'), ('us-ascii', 'ascii'), ('iso-8859-1', 'latin-1'), ('iso8859', 'latin-1'), ('cp1252', 'cp1252'), ('utf-16', 'utf-16'), ('utf-16', 'utf-16-le'), ('utf-16', 'utf-16-be'), ('koi8-r', 'koi8-r')]
for name, codec in encodings:
    for unit in ('a', '\xe9', 'ж', '中', '\U0001f600', 'a\xe9', 'ab中', 'a\U0001f600'):
        for n in (1, 340, 341, 342, 511, 512, 513, 1023, 1024, 1025, 2047, 2048, 2049, 3100):
            text = (unit * n)[:n] if len(unit) > 1 else unit * n
            doc = '<?xml version="1.0" encoding="%s"?><s>%s</s>' % (name, text)
            try: data = doc.encode(codec)
            except UnicodeError: continue
            print(name, codec, ascii(unit), n, pieces(data))
            if n in (1024, 1025, 2049):
                print(' buffered', pieces(data, True), pieces(data, True, 1024), pieces(data, True, 1000), pieces(data, True, 100), pieces(data, True, 3000))
                print(' default', pieces(data, default=True))
                print(' fed', pieces(data, feed=700), pieces(data, True, 1024, feed=700))

for name, codec in encodings:
    for n in (1000, 1024, 1025, 2500):
        for template in ('<s><![CDATA[%s]]></s>', '<s><!--%s--></s>', '<s><?pi %s?></s>', '<s a="%s"/>', '<s>x\n%s\ny</s>', '<s>%s&amp;%s</s>', '<!DOCTYPE s [<!ENTITY e "%s">]><s>&e;</s>', '<!--%s--><s/>', '<s/><!--%s-->'):
            doc = '<?xml version="1.0" encoding="%s"?>' % name + template.replace('%s', 'b' * n)
            data = doc.encode(codec)
            print(name, codec, n, template, pieces(data), pieces(data, default=True), pieces(data, True, 1024))

# Half a code unit at the end.
for data in (b'\0\r\n', b'\0\r', b'\0 \0', b'\xff\xfe<\0a\0/\0>\0\n', b'\xff\xfe<\0a\0>\0x', b'\xff\xfe<\0a\0>\0x\0<', b'\xff\xfe<\0a\0>\0<\0!\0[\0C\0D\0A\0T\0A\0[\0x', b'\xfe\xff\0<\0a\0/\0>\0', b'\xfe\xff\0<\0!\0-\0-\0-\0-\0>\0', b'\xff\xfe\0', b'\xff\xfe'):
    print(data, pieces(data), pieces(data, feed=1))
