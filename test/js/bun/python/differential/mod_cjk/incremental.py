# The incremental encoders and decoders, with texts cut at every position.
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

for name in ALL:
    info = codecs.lookup(name)
    text = sample(name)
    data = info.encode(text)[0]
    print(name, len(text), len(data), crc(data), info.decode(data)[0] == text)

    # Encoding in two parts.
    results = []
    for i in range(len(text) + 1):
        e = info.incrementalencoder()
        first = e.encode(text[:i])
        state = e.getstate()
        second = e.encode(text[i:], True)
        results.append((first, state, second, e.getstate()))
        if first + second != data:
            print('  differs at', i, first, second)
    print('  encode', crc(results))
    # A character at a time; then nothing, finally.
    e = info.incrementalencoder()
    results = [(e.encode(c), e.getstate()) for c in text] + [e.encode('', True), e.getstate()]
    print('  encode by one', crc(results), b''.join(r[0] for r in results[:-2]) + results[-2] == data)
    # Each part final.
    e = info.incrementalencoder()
    print('  encode final', crc([(e.encode(c, True), e.getstate()) for c in text]))
    # reset() in the middle.
    results = []
    for i in range(len(text) + 1):
        e = info.incrementalencoder()
        first = e.encode(text[:i])
        e.reset()
        results.append((first, e.getstate(), e.encode(text[i:], True)))
    print('  encode reset', crc(results))
    # The state moves to another encoder.
    for i in range(len(text) + 1):
        e = info.incrementalencoder()
        first = e.encode(text[:i])
        other = info.incrementalencoder()
        other.setstate(e.getstate())
        assert other.getstate() == e.getstate()
        if first + other.encode(text[i:], True) != data:
            print('  state lost at', i)

    # Decoding in two parts.
    results = []
    for i in range(len(data) + 1):
        d = info.incrementaldecoder()
        first = d.decode(data[:i])
        state = d.getstate()
        second = d.decode(data[i:], True)
        results.append((first, state, second, d.getstate()))
        if first + second != text:
            print('  differs at', i, ascii(first), ascii(second))
    print('  decode', crc(results))
    d = info.incrementaldecoder()
    results = [(d.decode(bytes([b])), d.getstate()) for b in data] + [d.decode(b'', True), d.getstate()]
    print('  decode by one', crc(results), ''.join(r[0] for r in results[:-2]) + results[-2] == text)
    # The data ends at each position.
    for errors in ('strict', 'ignore', 'replace', 'backslashreplace', 'surrogateescape'):
        results = []
        for i in range(len(data) + 1):
            d = info.incrementaldecoder(errors)
            results.append((outcome(d.decode, data[:i], True), d.getstate(), outcome(d.decode, data[i:], True), d.getstate()))
        print('  decode cut', errors, crc(results))
    results = []
    for i in range(len(data) + 1):
        d = info.incrementaldecoder()
        first = d.decode(data[:i])
        d.reset()
        results.append((first, d.getstate(), outcome(d.decode, data[i:], True), d.getstate()))
    print('  decode reset', crc(results))
    for i in range(len(data) + 1):
        d = info.incrementaldecoder()
        first = d.decode(data[:i])
        other = info.incrementaldecoder()
        other.setstate(d.getstate())
        assert other.getstate() == d.getstate()
        if first + other.decode(data[i:], True) != text:
            print('  state lost at', i)
    # What is pending survives an error, or does not.
    results = []
    for i in range(len(data) + 1):
        d = info.incrementaldecoder()
        d.decode(data[:i])
        before = d.getstate()
        results.append((before, outcome(d.decode, b'\xff\xff'), d.getstate(), outcome(d.decode, b'', True), d.getstate(), outcome(d.decode, b'a'), d.getstate()))
    print('  decode error', crc(results))
    results = []
    for i in range(len(text) + 1):
        e = info.incrementalencoder()
        e.encode(text[:i])
        before = e.getstate()
        results.append((before, outcome(e.encode, '\ud800'), e.getstate(), outcome(e.encode, '', True), e.getstate(), outcome(e.encode, 'a'), e.getstate()))
    print('  encode error', crc(results))
