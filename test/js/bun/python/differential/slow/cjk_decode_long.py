# Sequences of more than two bytes.
import os, sys
sys.dont_write_bytecode = True
above = os.path.dirname(os.path.abspath(__file__))
while not os.path.isdir(os.path.join(above, 'mod_cjk')): above = os.path.dirname(above)
sys.path.insert(0, os.path.join(above, 'mod_cjk'))
from common import *

# After 0x8F, EUC has a second set.
for name in ('euc_jp', 'euc_jis_2004', 'euc_jisx0213'):
    decode = codecs.lookup(name).decode
    show(name + ' 8F', [crc(*[outcome(decode, bytes([0x8F, a, b])) for b in range(256)]) for a in range(256)])
    print(name, crc(*[outcome(decode, bytes([0x8E, a, b])) for a in (0, 0x7F, 0xA0, 0xA1, 0xDF, 0xE0, 0xFF) for b in (0, 0x41, 0x8E, 0xA1)]))

# GB 18030 in four bytes: all there is for the BMP, the edges of everything, and every 97th of the rest.
decode = codecs.lookup('gb18030').decode
def four(n):
    return bytes([0x81 + n // 12600, 0x30 + n // 1260 % 10, 0x81 + n // 10 % 126, 0x30 + n % 10])
show('gb18030 BMP', [crc(*[outcome(decode, four(n)) for n in range(first, first + 256)]) for first in range(0, 40192, 256)])
show('gb18030 rest', [crc(*[outcome(decode, four(n)) for n in range(first, first + 12600, 97)]) for first in range(0, 126 * 12600, 12600)])
edges = [39419, 39420, 39421, 188999, 189000, 189001, 189000 + 0xFFFFF, 189000 + 0x100000, 189000 + 0x100001, 126 * 12600 - 1]
print([outcome(decode, four(n)) for n in edges])
print(crc(*[outcome(decode, bytes([a, b, c, d])) for a in (0x80, 0x81, 0x84, 0x85, 0x8F, 0x90, 0xE3, 0xE4, 0xFE, 0xFF) for b in (0x2F, 0x30, 0x39, 0x3A)
            for c in (0x30, 0x7F, 0x80, 0x81, 0xFE, 0xFF) for d in (0x2F, 0x30, 0x39, 0x3A, 0x81)]))
print([outcome(decode, data) for data in (b'\x81', b'\x810', b'\x810\x81', b'\x810\x810', b'\x810\x81\x30a', b'a\x810\x81', b'\x81\x30\x30\x30', b'\xff\x30\x81\x30')])

# EUC-KR spells the syllables it has no code for.
decode = codecs.lookup('euc_kr').decode
values = (0x41, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xAA, 0xB0, 0xB8, 0xB9, 0xBE, 0xBF, 0xC0, 0xD3, 0xD4, 0xD5, 0xFE)
show('euc_kr spelt', [crc(*[outcome(decode, bytes([0xA4, 0xD4, 0xA4, a, 0xA4, b, 0xA4, c])) for c in range(0x9F, 0x100)]) for a in values for b in values])
print(crc(*[outcome(decode, bytes([0xA4, 0xD4, a, 0xA1, b, 0xBF, c, 0xD4])) for a in (0xA3, 0xA4, 0xA5) for b in (0xA3, 0xA4, 0x41) for c in (0xA4, 0, 0xFF)]))
print([outcome(decode, b'\xa4\xd4\xa4\xa1\xa4\xbf\xa4\xd4'[:n]) for n in range(9)])
for name in ('cp949', 'johab'):
    print(name, outcome(codecs.lookup(name).decode, b'\xa4\xd4\xa4\xa1\xa4\xbf\xa4\xd4'))

# HZ between ~{ and ~}.
decode = codecs.lookup('hz').decode
show('hz', [crc(*[outcome(decode, bytes([0x7E, 0x7B, a, b])) for b in range(256)]) for a in range(256)])
show('hz ~', [crc(*[outcome(decode, prefix + bytes([0x7E, b]) + suffix) for b in range(256)]) for prefix in (b'', b'~{', b'~{!!', b'~{~}') for suffix in (b'', b'!!', b'~}', b'a')])
