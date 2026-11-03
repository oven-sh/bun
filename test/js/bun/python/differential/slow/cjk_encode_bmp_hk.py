# Every character of the BMP and of plane 2, and some of the others, encoded by itself: the bytes, or where the error is and why.
import os, sys
sys.dont_write_bytecode = True
above = os.path.dirname(os.path.abspath(__file__))
while not os.path.isdir(os.path.join(above, 'mod_cjk')): above = os.path.dirname(above)
sys.path.insert(0, os.path.join(above, 'mod_cjk'))
from common import *

for name in GROUPS['hk']:
    encode = codecs.lookup(name).encode
    show(name, [crc(*[outcome(encode, chr(c)) for c in range(first, first + 256)]) for first in range(0, 0x10000, 256)])
    show(name + ' plane 2', [crc(*[outcome(encode, chr(c)) for c in range(first, first + 256)]) for first in range(0x20000, 0x30000, 256)])
    show(name + ' others', [crc(*[outcome(encode, chr(c)) for c in range(first, first + 0x10000, 251)]) for first in range(0x10000, 0x110000, 0x10000)])
