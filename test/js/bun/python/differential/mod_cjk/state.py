# getstate() and setstate() with states that no encoder or decoder gets into by itself.
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

def encoder_state(pending, state):
    data = pending.encode() if isinstance(pending, str) else pending
    return int.from_bytes(bytes([len(data)]) + data + state, 'little')

for name in ALL:
    info = codecs.lookup(name)
    print(name, hex(info.incrementalencoder().getstate()), info.incrementaldecoder().getstate())
    for pending in ('', 'a', 'ab', 'abcdefgh', '\u304b', '\u304b\u304b', '\xca', '\xe6', '\U00020000\U00020000', '\u3042\u3042', '\xe9', b'\xff', b'\xc3', b'\xed\xa0\x80', b'\x00'):
        for state in (bytes(8), b'BB' + bytes(6), b'\xc2B' + bytes(6), b'B\xc3\0\0\1\0\0\0', b'\1' + bytes(7), bytes(range(1, 9)), b'\xff' * 8):
            e = info.incrementalencoder()
            print(' ', repr(pending), state.hex(), outcome(e.setstate, encoder_state(pending, state)), hex(e.getstate()),
                  outcome(e.encode, ''), hex(e.getstate()), outcome(e.encode, '\u309a'), hex(e.getstate()), outcome(e.encode, 'z', True), hex(e.getstate()))
    for pending in (b'', b'a', b'\x81', b'\x8f\xa1', b'\x1b', b'\x1b$', b'~', b'\xa4\xd4\xa4\xa1\xa4\xbf\xa4', b'\x810\x81', b'12345678', b'\xff' * 8):
        for state in (0, 0x424242, 0x4242c2, 0x42c342 | 1 << 32, 2 << 32, 1, 0x0807060504030201, (1 << 64) - 1, 0x41c142, 0x464242, 0xd14242):
            d = info.incrementaldecoder()
            print(' ', pending, hex(state), outcome(d.setstate, (pending, state)), d.getstate(), outcome(d.decode, b''), d.getstate(),
                  outcome(d.decode, b'!!'), d.getstate(), outcome(d.decode, b'\x1bN!'), d.getstate(), outcome(d.decode, b'\n', True), d.getstate())

# More may be pending than a decoder can keep.
for name in ALL:
    info = codecs.lookup(name)
    results = []
    for data in (b'\x81', b'\x1b$', b'\x1b' + b'$' * 7, b'\x1b' + b'$' * 8, b'\x1b' + b'$' * 14, b'\xa4\xd4\xa4\xa1\xa4\xbf\xa4', b'\x8f\xa1', b'\x810\x81', b'~'):
        d = info.incrementaldecoder()
        results.append((outcome(d.decode, data), d.getstate(), outcome(d.decode, data), d.getstate(), outcome(d.decode, data), d.getstate()))
    print(name, results)
