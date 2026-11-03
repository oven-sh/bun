# Every sequence of one and of two bytes, decoded by itself: what it is, or where the error is and why.
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
    for name in GROUPS['jp2004']:
        try: decode = codecs.lookup(name).decode
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: decode = codecs.lookup(name).decode')
        try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
        try: print('single', 'crc(*[outcome(decode, bytes([a])) for a in range(256)]) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', crc(*[outcome(decode, bytes([a])) for a in range(256)]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: crc(*[outcome(decode, bytes([a])) for a in range(256)])')
        try: show(name, [crc(*[outcome(decode, bytes([a, b])) for b in range(256)]) for a in range(256)])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(name, [crc(*[outcome(decode, bytes([a, b])) for b in range(256)]...')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name in GROUPS['jp2004']:")
