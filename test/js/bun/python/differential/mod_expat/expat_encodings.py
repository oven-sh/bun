import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from expat_common import *

text = '<a b="é">éÿ x</a>'
wide = '<a b="é中">中\U0001f600\n x &y;</a>'
cases = []
for enc in ('utf-8', 'UTF-8', 'iso-8859-1', 'ISO-8859-1', 'latin-1', 'latin1', 'us-ascii', 'ascii', 'US-ASCII', 'utf-16', 'UTF-16', 'utf-16le', 'utf-16be', 'UTF-16LE', 'utf-16-le', 'utf-32', 'cp1252', 'windows-1252', 'iso-8859-2', 'iso-8859-15', 'koi8-r', 'cp437', 'cp037', 'utf-7', 'nope', 'x-y', 'utf8', 'UTF8', 'rot13', 'hex', 'mbcs', 'utf-8-sig', 'macroman'):
    for doc in (text, '<a>x</a>'):
        decl = '<?xml version="1.0" encoding="%s"?>' % enc
        for codec in (enc, 'utf-8', 'latin-1', 'utf-16', 'utf-16-le', 'utf-16-be'):
            # A document in UTF-16 that claims an encoding Expat asks Python about is read on byte by byte: an error, at a column
            # that depends on when the position was last asked for.
            if codec.startswith('utf-16') and enc.lower() not in ('utf-8', 'iso-8859-1', 'us-ascii', 'utf-16', 'utf-16le', 'utf-16be', 'nope', 'x-y'): continue
            try: data = (decl + doc).encode(codec)
            except (LookupError, UnicodeError): continue
            cases.append((enc, codec, data))
for enc, codec, data in cases:
    print(enc, codec, data)
    run(data, handlers=['StartElementHandler', 'CharacterDataHandler', 'XmlDeclHandler'], positions=True)
# Given to ParserCreate
for enc in ('utf-8', 'iso-8859-1', 'us-ascii', 'utf-16', 'utf-16le', 'utf-16be', 'cp1252', 'koi8-r', 'nope', 'latin-1', 'utf-32', ''):
    for doc in (text, '<?xml version="1.0" encoding="iso-8859-1"?>' + text, '<?xml version="1.0" encoding="nope"?><a/>', '<a/>'):
        for codec in ('utf-8', 'latin-1', 'utf-16', 'utf-16-le', 'utf-16-be', 'cp1252', 'koi8-r'):
            # Bytes taken two at a time are ideographs, of which the editions of XML 1.0 think differently.
            if enc.startswith('utf-16') and not codec.startswith('utf-16'): continue
            if codec.startswith('utf-16') and 'nope' in doc and enc == '': continue
            try: data = doc.encode(codec)
            except UnicodeError: continue
            print(enc, codec, data)
            run(data, handlers=['StartElementHandler', 'CharacterDataHandler', 'XmlDeclHandler'], encoding=enc)
# str: the declaration is ignored
for doc in (text, wide, '<?xml version="1.0" encoding="iso-8859-1"?>' + text, '<?xml version="1.0" encoding="utf-16"?>' + wide, '<?xml version="1.0" encoding="nope"?>' + text, '﻿<a/>', '﻿<?xml version="1.0"?><a/>', '<a>﻿</a>', '<a>￾</a>', '<a>￿</a>', '<a>�</a>'):
    print(ascii(doc))
    run(doc, positions=True); run(doc, chunks=1, setup=lambda p: p.SetReparseDeferralEnabled(False)); run(doc, encoding='iso-8859-1'); run(doc, encoding='utf-16')
# Byte order marks, positions, pieces
for codec in ('utf-8', 'utf-8-sig', 'utf-16', 'utf-16-le', 'utf-16-be'):
    for doc in (wide, '<?xml version="1.0"?>\n' + wide, '<a>\n<b>中</c></a>', '<a>\U0001f600\U0001f600</b>', '<a 中="1" 中="2"/>', '  <a/>', '<a/>\n'):
        data = doc.encode(codec)
        print(codec, data)
        run(data, positions=True)
        for n in (1, 2, 3, 5): run(data, chunks=n, positions=True, setup=lambda p: p.SetReparseDeferralEnabled(False))
        run(data, handlers=[], default='DefaultHandler')
for data in (b'\xef', b'\xef\xbb', b'\xef\xbb\xbf', b'\xef\xbb\xbf<a/>', b'\xef\xbb<a/>', b'\xef\xbb\xbf\xef\xbb\xbf<a/>', b'\xfe', b'\xfe\xff', b'\xff\xfe', b'\xff\xfe<\x00a\x00/\x00>\x00', b'\xfe\xff\x00<\x00a\x00/\x00>', b'\xff\xfe<\x00a\x00/\x00>', b'\xff\xfe<\x00a\x00/\x00', b'<\x00a\x00/\x00>\x00', b'\x00<\x00a\x00/\x00>',
             b'<\x00', b'\x00', b'<', b'\x00\x00', b' \x00<\x00a\x00/\x00>\x00', b'\xff\xfe<\x00a\x00>\x00\x00\xd8<\x00', b'\xff\xfe<\x00a\x00>\x00\x3d\xd8\x00\xde<\x00/\x00a\x00>\x00', b'\xff\xfe<\x00a\x00>\x00\x00\xde<\x00', b'\xff\xfe<\x00a\x00>\x00\x3d\xd8', b'\xff\xfe<\x00a\x00>\x00\xff\xff<\x00',
             b'\xff\xfe\xff\xfe<\x00a\x00/\x00>\x00', b'\xff\xff', b'\xfe\xfe', b'<?xml version="1.0" encoding="utf-16"?><a/>', '<?xml version="1.0" encoding="utf-8"?><a/>'.encode('utf-16'), '<?xml version="1.0" encoding="utf-16be"?><a/>'.encode('utf-16-le'), '<?xml version="1.0" encoding="utf-16le"?><a/>'.encode('utf-16-le'),
             '<?xml version="1.0" encoding="iso-8859-1"?><a/>'.encode('utf-16'), '<?xml version="1.0" encoding="nope"?><a/>'.encode('utf-16'), b'<?xml version="1.0" encoding="us-ascii"?><a>\xe9</a>', b'<?xml version="1.0" encoding="iso-8859-1"?><a>\xe9\x80\x9f</a>', b'<?xml version="1.0" encoding="cp1252"?><a>\x80\x81\x9f</a>',
             b'<?xml version="1.0" encoding="iso-8859-1"?><\xe9 \xe8="\xe7"/>', b'<?xml version="1.0" encoding="iso-8859-1"?><\xd7/>', b'<?xml version="1.0" encoding="koi8-r"?><\xc1>\xc2</\xc1>', b'<?xml version="1.0" encoding="iso-8859-1"?>\n<a>\xe9\xe9</b>', b'<?xml version="1.0" encoding="cp1252"?>\n<a>\x80\x80</b>'):
    print(data)
    run(data, positions=True)
    run(data, chunks=1, setup=lambda p: p.SetReparseDeferralEnabled(False))

# Every codec of one byte to the character that Python has.
import encodings.aliases
for codec in sorted(set(encodings.aliases.aliases.values()) | {'cp037', 'mac_arabic', 'mac_farsi', 'cp864', 'hex_codec', 'rot_13', 'undefined', 'unicode_escape', 'raw_unicode_escape', 'punycode', 'charmap', 'palmos', 'koi8_t', 'kz1048'}):
    if codec.startswith(('big5', 'cp932', 'cp949', 'cp950', 'euc_', 'gb', 'hz', 'iso2022', 'johab', 'shift_jis', 'idna', 'mbcs', 'oem', 'bz2')): continue
    doc = '<?xml version="1.0" encoding="%s"?>\n<root a="$@\\^`{}~">x</root>' % codec
    for how in ('ascii', codec):
        try: data = doc.encode(how)
        except Exception as e:
            print(codec, how, 'cannot be encoded')
            continue
        print(codec, how)
        run(data + bytes(range(0x80, 0x100)) if how == 'ascii' else data)
