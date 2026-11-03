# All of the tables at a glance: every two bytes and every character of the BMP and of plane 2, many at a time, so that it is quick.
# (What each of them is by itself is for the tests that take long.)
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

rows = [b''.join(bytes([a, b, 10]) for b in range(256)) for a in range(256)]
seven = [b''.join(bytes([a, b]) for b in range(0x21, 0x7F)) for a in range(0x21, 0x7F)]
blocks = [''.join(map(chr, range(first, first + 256))) for first in list(range(0, 0x10000, 256)) + list(range(0x20000, 0x30000, 256))]
designations = {'iso2022_kr': [b'\x1b$)C\x0e'], 'iso2022_jp': [b'\x1b$B', b'\x1b$@', b'\x1b(J'], 'iso2022_jp_1': [b'\x1b$(D'], 'iso2022_jp_2': [b'\x1b$A', b'\x1b$(C', b'\x1b$(D'],
                'iso2022_jp_2004': [b'\x1b$(Q', b'\x1b$(P', b'\x1b$B'], 'iso2022_jp_3': [b'\x1b$(O', b'\x1b$(P'], 'iso2022_jp_ext': [b'\x1b(I', b'\x1b$(D'], 'hz': [b'~{']}
for name in ALL:
    encode, decode = codecs.lookup(name)[:2]
    print(name, 'decode', crc(*[decode(row, 'replace')[0] for row in rows]), 'encode', crc(*[encode(block, 'replace')[0] for block in blocks]))
    for prefix in designations.get(name, ()):
        print(name, prefix, crc(*[decode(prefix + row, 'replace')[0] for row in seven]))
for name in ('euc_jp', 'euc_jis_2004', 'euc_jisx0213'):
    decode = codecs.lookup(name).decode
    print(name, '8F', crc(*[decode(b''.join(bytes([0x8F, a, b, 10]) for b in range(0xA0, 0x100)), 'replace')[0] for a in range(0xA0, 0x100)]))
decode = codecs.lookup('gb18030').decode
print('gb18030 four', crc(*[decode(b''.join(bytes([a, b, c, d]) for c in range(0x81, 0xFF) for d in range(0x30, 0x3A)), 'replace')[0] for a in (0x81, 0x82, 0x83, 0x84, 0x85, 0x90, 0xE3, 0xE4) for b in range(0x30, 0x3A)]))
