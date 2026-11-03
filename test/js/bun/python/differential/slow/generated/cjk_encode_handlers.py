# The characters of the BMP, 256 at a time, with each way of treating those that cannot be encoded.
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

try: seen = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen = []')
try:
    def note(e):
        seen.append((e.start, e.end, e.reason, e.encoding, len(e.object)))
        return ('[%d]' % e.start, e.end)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def note(e):')
try:
    def raw(e):
        return (b'\xff\x00', e.end)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raw(e):')
try:
    def two(e):
        return ('', min(e.end + 1, len(e.object)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def two(e):')
try: codecs.register_error('test.note', note)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: codecs.register_error('test.note', note)")
try: codecs.register_error('test.raw', raw)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: codecs.register_error('test.raw', raw)")
try: codecs.register_error('test.two', two)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: codecs.register_error('test.two', two)")

try: blocks = [''.join(map(chr, range(first, first + 256))) for first in list(range(0, 0x10000, 256)) + [0x1F600, 0x20000, 0x20B00, 0x2A600, 0x2F800, 0xE0000, 0x10FF00]]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: blocks = [''.join(map(chr, range(first, first + 256))) for first in l...")
try:
    for name in ALL:
        try: encode = codecs.lookup(name).encode
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: encode = codecs.lookup(name).encode')
        for errors in ('strict', 'ignore', 'replace', 'xmlcharrefreplace', 'backslashreplace', 'namereplace', 'surrogateescape', 'surrogatepass', 'test.note', 'test.raw', 'test.two'):
            try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'errors=' + (repr(errors) if type(errors) in (str, int, float, bytes, bool, type(None)) or (type(errors) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in errors)) else errors.__name__ if type(errors) is type else type(errors).__name__) + '] =>', name)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
            try: print('errors [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'errors=' + (repr(errors) if type(errors) in (str, int, float, bytes, bool, type(None)) or (type(errors) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in errors)) else errors.__name__ if type(errors) is type else type(errors).__name__) + '] =>', errors)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: errors')
            try: print('crc(*[outcome(encode, block, errors) for block in blocks]) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'errors=' + (repr(errors) if type(errors) in (str, int, float, bytes, bool, type(None)) or (type(errors) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in errors)) else errors.__name__ if type(errors) is type else type(errors).__name__) + '] =>', crc(*[outcome(encode, block, errors) for block in blocks]))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: crc(*[outcome(encode, block, errors) for block in blocks])')
            try: print('crc(seen) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'errors=' + (repr(errors) if type(errors) in (str, int, float, bytes, bool, type(None)) or (type(errors) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in errors)) else errors.__name__ if type(errors) is type else type(errors).__name__) + '] =>', crc(seen))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: crc(seen)')
            try: seen.clear()
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen.clear()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name in ALL:')
