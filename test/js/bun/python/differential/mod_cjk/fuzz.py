# Random bytes through every decoder, and random text through every encoder, with every way of treating errors.
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

def shift(e):
    # Sometimes on, sometimes back a little (never to where it would come round again).
    return ('\ufffd', e.end if e.start % 3 else min(e.end + 1, len(e.object)))
codecs.register_error('test.shift', shift)

random = Random(20261103)
# Bytes that mean something to one codec or another come up more often.
special = bytes([0x1B, 0x24, 0x28, 0x29, 0x2E, 0x4E, 0x40, 0x42, 0x41, 0x43, 0x44, 0x4A, 0x49, 0x4F, 0x50, 0x51, 0x0E, 0x0F, 0x0A, 0x7E, 0x7B, 0x7D, 0x8E, 0x8F, 0xA4, 0xD4, 0x30, 0x39, 0x81, 0xFE, 0x80, 0xFF, 0xA1, 0x26])
def some_bytes(n):
    return bytes(special[random.below(len(special))] if random.below(3) == 0 else random.below(256) for i in range(n))
ranges = [(0, 0x80), (0x80, 0x500), (0x2000, 0x2700), (0x3000, 0x3400), (0x4E00, 0xA000), (0xAC00, 0xD7B0), (0xD800, 0xE000), (0xE000, 0xE800), (0xF900, 0x10000), (0x20000, 0x2A700), (0x10000, 0x110000)]
def some_text(n):
    result = []
    for i in range(n):
        low, high = ranges[random.below(len(ranges))]
        c = low + random.below(high - low)
        # A high surrogate before a low one is another character here and there.
        if 0xDC00 <= c < 0xE000 and result and 0xD800 <= ord(result[-1]) < 0xDC00:
            c = 0x41
        result.append(chr(c))
    return ''.join(result)

datas = [some_bytes(1 + random.below(60)) for i in range(50)]
texts = [some_text(1 + random.below(40)) for i in range(30)]
for name in ALL:
    info = codecs.lookup(name)
    for errors in ('strict', 'ignore', 'replace', 'backslashreplace', 'surrogateescape', 'test.shift'):
        whole = [outcome(info.decode, data, errors) for data in datas]
        pieces = []
        for data in datas:
            d = info.incrementaldecoder(errors)
            cut = len(data) // 2
            pieces.append((outcome(d.decode, data[:cut]), d.getstate(), outcome(d.decode, data[cut:], True), d.getstate()))
        print(name, 'decode', errors, crc(whole), crc(pieces))
    for errors in ('strict', 'ignore', 'replace', 'backslashreplace', 'xmlcharrefreplace', 'surrogateescape', 'test.shift'):
        whole = [outcome(info.encode, text, errors) for text in texts]
        pieces = []
        for text in texts:
            e = info.incrementalencoder(errors)
            cut = len(text) // 2
            pieces.append((outcome(e.encode, text[:cut]), e.getstate(), outcome(e.encode, text[cut:], True), e.getstate()))
        print(name, 'encode', errors, crc(whole), crc(pieces))
