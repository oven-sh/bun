# The characters of the BMP, 256 at a time, with each way of treating those that cannot be encoded.
import os, sys
sys.dont_write_bytecode = True
above = os.path.dirname(os.path.abspath(__file__))
while not os.path.isdir(os.path.join(above, 'mod_cjk')): above = os.path.dirname(above)
sys.path.insert(0, os.path.join(above, 'mod_cjk'))
from common import *

seen = []
def note(e):
    seen.append((e.start, e.end, e.reason, e.encoding, len(e.object)))
    return ('[%d]' % e.start, e.end)
def raw(e):
    return (b'\xff\x00', e.end)
def two(e):
    return ('', min(e.end + 1, len(e.object)))
codecs.register_error('test.note', note)
codecs.register_error('test.raw', raw)
codecs.register_error('test.two', two)

blocks = [''.join(map(chr, range(first, first + 256))) for first in list(range(0, 0x10000, 256)) + [0x1F600, 0x20000, 0x20B00, 0x2A600, 0x2F800, 0xE0000, 0x10FF00]]
for name in ALL:
    encode = codecs.lookup(name).encode
    for errors in ('strict', 'ignore', 'replace', 'xmlcharrefreplace', 'backslashreplace', 'namereplace', 'surrogateescape', 'surrogatepass', 'test.note', 'test.raw', 'test.two'):
        print(name, errors, crc(*[outcome(encode, block, errors) for block in blocks]), crc(seen))
        seen.clear()
