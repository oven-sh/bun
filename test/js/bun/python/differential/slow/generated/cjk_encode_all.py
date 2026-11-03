# Every code point, 256 at a time: what cannot be encoded becomes a question mark.
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

try: blocks = [''.join(map(chr, range(first, first + 256))) for first in range(0, 0x110000, 256)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: blocks = [''.join(map(chr, range(first, first + 256))) for first in r...")
try:
    for name in ALL:
        try: encode = codecs.lookup(name).encode
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: encode = codecs.lookup(name).encode')
        try: show(name, [crc(encode(block, 'replace')[0]) for block in blocks], 32)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show(name, [crc(encode(block, 'replace')[0]) for block in blocks], 32)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name in ALL:')
