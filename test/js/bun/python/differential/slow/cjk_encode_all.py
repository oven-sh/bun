# Every code point, 256 at a time: what cannot be encoded becomes a question mark.
import os, sys
sys.dont_write_bytecode = True
above = os.path.dirname(os.path.abspath(__file__))
while not os.path.isdir(os.path.join(above, 'mod_cjk')): above = os.path.dirname(above)
sys.path.insert(0, os.path.join(above, 'mod_cjk'))
from common import *

blocks = [''.join(map(chr, range(first, first + 256))) for first in range(0, 0x110000, 256)]
for name in ALL:
    encode = codecs.lookup(name).encode
    show(name, [crc(encode(block, 'replace')[0]) for block in blocks], 32)
