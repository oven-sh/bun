# All sequences of two bytes with the same first byte in a row, a line feed after each, with each way of treating errors.
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
    def back(e):
        # Goes on in the middle of what was wrong.
        return ('<', e.start + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def back(e):')
try:
    def skip(e):
        return ('', min(e.end + 1, len(e.object)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def skip(e):')
try: codecs.register_error('test.note', note)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: codecs.register_error('test.note', note)")
try: codecs.register_error('test.back', back)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: codecs.register_error('test.back', back)")
try: codecs.register_error('test.skip', skip)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: codecs.register_error('test.skip', skip)")

try: rows = [b''.join(bytes([a, b, 10]) for b in range(256)) for a in range(256)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: rows = [b''.join(bytes([a, b, 10]) for b in range(256)) for a in rang...")
try:
    for name in ALL:
        try: decode = codecs.lookup(name).decode
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: decode = codecs.lookup(name).decode')
        for errors in ('strict', 'ignore', 'replace', 'backslashreplace', 'surrogateescape', 'surrogatepass', 'xmlcharrefreplace', 'namereplace', 'test.note', 'test.back', 'test.skip'):
            try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'errors=' + (repr(errors) if type(errors) in (str, int, float, bytes, bool, type(None)) or (type(errors) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in errors)) else errors.__name__ if type(errors) is type else type(errors).__name__) + '] =>', name)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
            try: print('errors [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'errors=' + (repr(errors) if type(errors) in (str, int, float, bytes, bool, type(None)) or (type(errors) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in errors)) else errors.__name__ if type(errors) is type else type(errors).__name__) + '] =>', errors)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: errors')
            try: print('crc(*[outcome(decode, row, errors) for row in rows]) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'errors=' + (repr(errors) if type(errors) in (str, int, float, bytes, bool, type(None)) or (type(errors) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in errors)) else errors.__name__ if type(errors) is type else type(errors).__name__) + '] =>', crc(*[outcome(decode, row, errors) for row in rows]))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: crc(*[outcome(decode, row, errors) for row in rows])')
            try: print('crc(seen) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'errors=' + (repr(errors) if type(errors) in (str, int, float, bytes, bool, type(None)) or (type(errors) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in errors)) else errors.__name__ if type(errors) is type else type(errors).__name__) + '] =>', crc(seen))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: crc(seen)')
            try: seen.clear()
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen.clear()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name in ALL:')
