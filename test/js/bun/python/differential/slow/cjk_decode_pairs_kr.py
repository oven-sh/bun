# Every sequence of one and of two bytes, decoded by itself: what it is, or where the error is and why.
import os, sys
sys.dont_write_bytecode = True
above = os.path.dirname(os.path.abspath(__file__))
while not os.path.isdir(os.path.join(above, 'mod_cjk')): above = os.path.dirname(above)
sys.path.insert(0, os.path.join(above, 'mod_cjk'))
from common import *

for name in GROUPS['kr']:
    decode = codecs.lookup(name).decode
    print(name, 'single', crc(*[outcome(decode, bytes([a])) for a in range(256)]))
    show(name, [crc(*[outcome(decode, bytes([a, b])) for b in range(256)]) for a in range(256)])
