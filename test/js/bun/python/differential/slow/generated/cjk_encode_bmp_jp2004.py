# Every character of the BMP and of plane 2, and some of the others, encoded by itself: the bytes, or where the error is and why.
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
        try: encode = codecs.lookup(name).encode
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: encode = codecs.lookup(name).encode')
        try: show(name, [crc(*[outcome(encode, chr(c)) for c in range(first, first + 256)]) for first in range(0, 0x10000, 256)])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(name, [crc(*[outcome(encode, chr(c)) for c in range(first, first...')
        try: show(name + ' plane 2', [crc(*[outcome(encode, chr(c)) for c in range(first, first + 256)]) for first in range(0x20000, 0x30000, 256)])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show(name + ' plane 2', [crc(*[outcome(encode, chr(c)) for c in range...")
        try: show(name + ' others', [crc(*[outcome(encode, chr(c)) for c in range(first, first + 0x10000, 251)]) for first in range(0x10000, 0x110000, 0x10000)])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show(name + ' others', [crc(*[outcome(encode, chr(c)) for c in range(...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name in GROUPS['jp2004']:")
