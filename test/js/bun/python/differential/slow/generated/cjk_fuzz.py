# Random bytes through every decoder, and random text through every encoder, with every way of treating errors.
try: import os, sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import os, sys')
try: sys.dont_write_bytecode = True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.dont_write_bytecode = True')
try: above = os.path.dirname(os.path.abspath(__file__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: above = os.path.dirname(os.path.abspath(__file__))')
try:
    while not os.path.isdir(os.path.join(above, 'mod_cjk')): above = os.path.dirname(above)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: while not os.path.isdir(os.path.join(above, 'mod_cjk')): above = os.p...")
try: sys.path.insert(0, os.path.join(above, 'mod_cjk'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: sys.path.insert(0, os.path.join(above, 'mod_cjk'))")
try: from common import *
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from common import *')

try:
    def shift(e):
        # Sometimes on, sometimes back a little (never to where it would come round again).
        return ('\ufffd', e.end if e.start % 3 else min(e.end + 1, len(e.object)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def shift(e):')
try: codecs.register_error('test.shift', shift)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: codecs.register_error('test.shift', shift)")

try: random = Random(3110262)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: random = Random(3110262)')
# Bytes that mean something to one codec or another come up more often.
try: special = bytes([0x1B, 0x24, 0x28, 0x29, 0x2E, 0x4E, 0x40, 0x42, 0x41, 0x43, 0x44, 0x4A, 0x49, 0x4F, 0x50, 0x51, 0x0E, 0x0F, 0x0A, 0x7E, 0x7B, 0x7D, 0x8E, 0x8F, 0xA4, 0xD4, 0x30, 0x39, 0x81, 0xFE, 0x80, 0xFF, 0xA1, 0x26])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: special = bytes([0x1B, 0x24, 0x28, 0x29, 0x2E, 0x4E, 0x40, 0x42, 0x41...')
try:
    def some_bytes(n):
        return bytes(special[random.below(len(special))] if random.below(3) == 0 else random.below(256) for i in range(n))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def some_bytes(n):')
try: ranges = [(0, 0x80), (0x80, 0x500), (0x2000, 0x2700), (0x3000, 0x3400), (0x4E00, 0xA000), (0xAC00, 0xD7B0), (0xD800, 0xE000), (0xE000, 0xE800), (0xF900, 0x10000), (0x20000, 0x2A700), (0x10000, 0x110000)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ranges = [(0, 0x80), (0x80, 0x500), (0x2000, 0x2700), (0x3000, 0x3400...')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def some_text(n):')

try: datas = [some_bytes(1 + random.below(60)) for i in range(3000)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: datas = [some_bytes(1 + random.below(60)) for i in range(3000)]')
try: texts = [some_text(1 + random.below(40)) for i in range(2000)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: texts = [some_text(1 + random.below(40)) for i in range(2000)]')
try:
    for name in ALL:
        try: info = codecs.lookup(name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: info = codecs.lookup(name)')
        for errors in ('strict', 'ignore', 'replace', 'backslashreplace', 'surrogateescape', 'test.shift'):
            try: whole = [outcome(info.decode, data, errors) for data in datas]
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: whole = [outcome(info.decode, data, errors) for data in datas]')
            try: pieces = []
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pieces = []')
            for data in datas:
                try: d = info.incrementaldecoder(errors)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = info.incrementaldecoder(errors)')
                try: cut = len(data) // 2
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cut = len(data) // 2')
                try: pieces.append((outcome(d.decode, data[:cut]), d.getstate(), outcome(d.decode, data[cut:], True), d.getstate()))
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pieces.append((outcome(d.decode, data[:cut]), d.getstate(), outcome(d...')
            try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'errors=' + (repr(errors) if type(errors) in (str, int, float, bytes, bool, type(None)) or (type(errors) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in errors)) else errors.__name__ if type(errors) is type else type(errors).__name__) + '] =>', name)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
            try: print('decode', 'errors [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'errors=' + (repr(errors) if type(errors) in (str, int, float, bytes, bool, type(None)) or (type(errors) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in errors)) else errors.__name__ if type(errors) is type else type(errors).__name__) + '] =>', errors)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: errors')
            try: print('crc(whole) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'errors=' + (repr(errors) if type(errors) in (str, int, float, bytes, bool, type(None)) or (type(errors) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in errors)) else errors.__name__ if type(errors) is type else type(errors).__name__) + '] =>', crc(whole))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: crc(whole)')
            try: print('crc(pieces) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'errors=' + (repr(errors) if type(errors) in (str, int, float, bytes, bool, type(None)) or (type(errors) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in errors)) else errors.__name__ if type(errors) is type else type(errors).__name__) + '] =>', crc(pieces))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: crc(pieces)')
        for errors in ('strict', 'ignore', 'replace', 'backslashreplace', 'xmlcharrefreplace', 'surrogateescape', 'test.shift'):
            try: whole = [outcome(info.encode, text, errors) for text in texts]
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: whole = [outcome(info.encode, text, errors) for text in texts]')
            try: pieces = []
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pieces = []')
            for text in texts:
                try: e = info.incrementalencoder(errors)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = info.incrementalencoder(errors)')
                try: cut = len(text) // 2
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cut = len(text) // 2')
                try: pieces.append((outcome(e.encode, text[:cut]), e.getstate(), outcome(e.encode, text[cut:], True), e.getstate()))
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pieces.append((outcome(e.encode, text[:cut]), e.getstate(), outcome(e...')
            try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'errors=' + (repr(errors) if type(errors) in (str, int, float, bytes, bool, type(None)) or (type(errors) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in errors)) else errors.__name__ if type(errors) is type else type(errors).__name__) + '] =>', name)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
            try: print('encode', 'errors [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'errors=' + (repr(errors) if type(errors) in (str, int, float, bytes, bool, type(None)) or (type(errors) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in errors)) else errors.__name__ if type(errors) is type else type(errors).__name__) + '] =>', errors)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: errors')
            try: print('crc(whole) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'errors=' + (repr(errors) if type(errors) in (str, int, float, bytes, bool, type(None)) or (type(errors) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in errors)) else errors.__name__ if type(errors) is type else type(errors).__name__) + '] =>', crc(whole))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: crc(whole)')
            try: print('crc(pieces) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'errors=' + (repr(errors) if type(errors) in (str, int, float, bytes, bool, type(None)) or (type(errors) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in errors)) else errors.__name__ if type(errors) is type else type(errors).__name__) + '] =>', crc(pieces))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: crc(pieces)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name in ALL:')
