# ISO 2022: after each way of designating a set, every two bytes that may stand for something, and some that may not.
import os, sys
sys.dont_write_bytecode = True
above = os.path.dirname(os.path.abspath(__file__))
while not os.path.isdir(os.path.join(above, 'mod_cjk')): above = os.path.dirname(above)
sys.path.insert(0, os.path.join(above, 'mod_cjk'))
from common import *

finals = [bytes([c]) for c in b'@ABCDEFHIJKNOPQRZ']
prefixes = [b'\x1b' + middle + final for middle in (b'(', b')', b'$', b'$(', b'$)', b'.', b'-', b'$*', b'*', b'&', b'&@\x1b$', b'$-') for final in finals]
some = [0, 0x0A, 0x0E, 0x0F, 0x1B, 0x20, 0x21, 0x22, 0x30, 0x40, 0x5C, 0x7E, 0x7F, 0x80, 0xA1, 0xFF]
for name in GROUPS['iso2022']:
    decode = codecs.lookup(name).decode
    known = [prefix for prefix in prefixes if not isinstance(outcome(decode, prefix), str)]
    print(name, [prefix[1:].decode() for prefix in known])
    print(name, 'prefixes', crc(*[outcome(decode, prefix + tail) for prefix in prefixes for tail in (b'', b'a', b'!!', b'\x0e!!', b'\x1bN!', b'\x1bN\xa1')]))
    for prefix in known:
        for shift in (b'', b'\x0e'):
            digests = [crc(*[outcome(decode, prefix + shift + bytes([a, b])) for b in range(0x20, 0x80)]) for a in range(0x20, 0x80)]
            print(name, prefix[1:].decode(), len(shift), crc(*digests), crc(*[outcome(decode, prefix + shift + bytes([a, b])) for a in some for b in some]),
                  crc(*[outcome(decode, prefix + shift + bytes([a])) for a in range(256)]), crc(*[outcome(decode, prefix + b'\x1bN' + bytes([a])) for a in range(256)]))
    # Escape sequences that are none of ISO 2022's, or are cut short.
    print(name, 'escapes', crc(*[outcome(decode, b'\x1b' + bytes([a, b]) + tail) for a in range(256) for b in (0x20, 0x24, 0x28, 0x40, 0x41, 0x42, 0x5A, 0x5B, 0x80) for tail in (b'', b'B', b'ab\x1b$B!!')]))
    print(name, 'long', [outcome(decode, b'\x1b$' + b'(' * n + tail) for n in range(12, 17) for tail in (b'', b'B')])
    print(name, 'revision', [outcome(decode, data) for data in (b'\x1b&@\x1b$B!!', b'\x1b&@\x1b$A!!', b'\x1b&@\x1b$', b'\x1b&@', b'\x1b&', b'\x1b&@\x1b(B', b'\x1b&@\x1b$@!!', b'\x1b&@a', b'\x1b&A', b'\x1b&&@\x1b$B')])
