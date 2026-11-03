# A bytearray cannot be resized by what runs in the middle of one of its own methods.
try:
    def t(label, f):
        try:
            print(label, 'ok', f())
        except Exception as e:
            print(label, type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(label, f):')

try:
    def make():
        return bytearray(b'abc-def-ghi' * 8)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def make():')

try:
    class Index:
        def __init__(self, ba, value=0): self.ba, self.value = ba, value
        def __index__(self):
            self.ba.clear()
            return self.value
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Index:')

try:
    class Buffer:
        def __init__(self, ba, data=b'-'): self.ba, self.data = ba, data
        def __buffer__(self, flags):
            self.ba.clear()
            return memoryview(self.data)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Buffer:')

try:
    for name in ('find', 'rfind', 'index', 'rindex', 'count', 'startswith', 'endswith', 'split', 'rsplit', 'partition', 'rpartition', 'removeprefix', 'removesuffix', 'strip', 'lstrip', 'rstrip', 'join'):
        try: ba = make()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ba = make()')
        try: argument = [Buffer(ba)] if name == 'join' else Buffer(ba)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: argument = [Buffer(ba)] if name == 'join' else Buffer(ba)")
        try: t(name + ' __buffer__', lambda: getattr(ba, name)(argument))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t(name + ' __buffer__', lambda: getattr(ba, name)(argument))")
        try: print('   ', 'len(ba) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', len(ba))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(ba)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name in ('find', 'rfind', 'index', 'rindex', 'count', 'startswith...")
try:
    for name in ('find', 'rfind', 'index', 'rindex', 'count', 'startswith', 'endswith'):
        try: ba = make()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ba = make()')
        try: t(name + ' start', lambda: getattr(ba, name)(b'-', Index(ba)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t(name + ' start', lambda: getattr(ba, name)(b'-', Index(ba)))")
        try: print('   ', 'len(ba) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', len(ba))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(ba)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name in ('find', 'rfind', 'index', 'rindex', 'count', 'startswith...")
try:
    for name in ('find', 'rfind', 'index', 'rindex', 'count'):
        try: ba = make()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ba = make()')
        try: t(name + ' byte', lambda: getattr(ba, name)(Index(ba, 45)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t(name + ' byte', lambda: getattr(ba, name)(Index(ba, 45)))")
        try: print('   ', 'len(ba) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', len(ba))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(ba)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name in ('find', 'rfind', 'index', 'rindex', 'count'):")
try:
    for name in ('split', 'rsplit'):
        try: ba = make()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ba = make()')
        try: t(name + ' maxsplit', lambda: getattr(ba, name)(b'-', Index(ba, 1)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t(name + ' maxsplit', lambda: getattr(ba, name)(b'-', Index(ba, 1)))")
        try: print('   ', 'len(ba) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', len(ba))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(ba)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name in ('split', 'rsplit'):")
try: ba = make()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ba = make()')
try: t('in, __index__', lambda: Index(ba, 45) in ba)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('in, __index__', lambda: Index(ba, 45) in ba)")
try: ba = make()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ba = make()')
try: t('in, __buffer__', lambda: Buffer(ba) in ba)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('in, __buffer__', lambda: Buffer(ba) in ba)")

try:
    class Repr:
        def __init__(self, ba): self.ba = ba
        def __repr__(self):
            self.ba.clear()
            return 'cleared'
        def __bytes__(self):
            self.ba.clear()
            return b'cleared'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Repr:')
try: ba = bytearray(b'%a and %a' + b' ' * 100)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ba = bytearray(b'%a and %a' + b' ' * 100)")
try: t('%a', lambda: (ba % (Repr(ba), 1)).strip())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('%a', lambda: (ba % (Repr(ba), 1)).strip())")
try: ba = bytearray(b'%b and %b' + b' ' * 100)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ba = bytearray(b'%b and %b' + b' ' * 100)")
try: t('%b', lambda: (ba % (Repr(ba), b'x')).strip())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('%b', lambda: (ba % (Repr(ba), b'x')).strip())")
try: ba = bytearray(b'%d' + b' ' * 100)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ba = bytearray(b'%d' + b' ' * 100)")
try: t('%d', lambda: (ba % Index(ba, 3)).strip())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('%d', lambda: (ba % Index(ba, 3)).strip())")

try:
    class Sep(bytes):
        ba = None
        def __len__(self):
            Sep.ba.clear()
            return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Sep(bytes):')
try: Sep.ba = ba = make()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Sep.ba = ba = make()')
try: t('hex', lambda: ba.hex(Sep(b':')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('hex', lambda: ba.hex(Sep(b':')))")
try:
    class Odd(bytes):
        def __len__(self): return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Odd(bytes):')
try:
    class OddStr(str):
        def __len__(self): return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class OddStr(str):')
try: t('hex, empty separator that says 1', lambda: b'ab'.hex(Odd()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('hex, empty separator that says 1', lambda: b'ab'.hex(Odd()))")
try: t('hex, empty separator that says 1', lambda: b'ab'.hex(OddStr()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('hex, empty separator that says 1', lambda: b'ab'.hex(OddStr()))")
try: t('hex, long separator that says 1', lambda: b'ab'.hex(Odd(b'xyz')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('hex, long separator that says 1', lambda: b'ab'.hex(Odd(b'xyz')))")

# join: the sequence is read as it is when each item's turn comes.
try:
    class Item:
        def __init__(self, action, data): self.action, self.data = action, data
        def __buffer__(self, flags):
            self.action()
            return memoryview(self.data)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Item:')
try:
    for sep in (b',', bytearray(b',')):
        try: items = [b'a', None, b'c']
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: items = [b'a', None, b'c']")
        try: items[1] = Item(lambda: items.append(b'd'), b'x')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: items[1] = Item(lambda: items.append(b'd'), b'x')")
        try: t('join, longer', lambda: sep.join(items))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('join, longer', lambda: sep.join(items))")
        try: items = [b'a', None, b'c']
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: items = [b'a', None, b'c']")
        try: items[1] = Item(lambda: items.pop(), b'x')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: items[1] = Item(lambda: items.pop(), b'x')")
        try: t('join, shorter', lambda: sep.join(items))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('join, shorter', lambda: sep.join(items))")
        try: items = [b'a', None, b'c']
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: items = [b'a', None, b'c']")
        try: items[1] = Item(lambda: items.clear(), b'x')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: items[1] = Item(lambda: items.clear(), b'x')")
        try: t('join, emptied', lambda: sep.join(items))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('join, emptied', lambda: sep.join(items))")
        try: items = [b'a', None, b'c']
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: items = [b'a', None, b'c']")
        try: items[1] = Item(lambda: items.__setitem__(1, b'z'), b'x')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: items[1] = Item(lambda: items.__setitem__(1, b'z'), b'x')")
        try: t('join, itself replaced', lambda: sep.join(items))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('join, itself replaced', lambda: sep.join(items))")
        try: items = [b'a', None, b'c']
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: items = [b'a', None, b'c']")
        try: items[1] = Item(lambda: items.__setitem__(2, b'z'), b'x')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: items[1] = Item(lambda: items.__setitem__(2, b'z'), b'x')")
        try: t('join, the next replaced', lambda: sep.join(items))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('join, the next replaced', lambda: sep.join(items))")
        try: items = [b'a', None, b'c']
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: items = [b'a', None, b'c']")
        try: items[1] = Item(lambda: items.__setitem__(0, b'z'), b'x')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: items[1] = Item(lambda: items.__setitem__(0, b'z'), b'x')")
        try: t('join, the one before replaced', lambda: sep.join(items))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('join, the one before replaced', lambda: sep.join(items))")
        try: other = bytearray(b'other')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: other = bytearray(b'other')")
        try: items = [other, Item(lambda: other.clear(), b'x')]
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: items = [other, Item(lambda: other.clear(), b'x')]")
        try: t('join, an item resized', lambda: sep.join(items))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('join, an item resized', lambda: sep.join(items))")
        try: t('join, not bytes', lambda: sep.join([b'a', Item(lambda: None, b'x'), 1]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('join, not bytes', lambda: sep.join([b'a', Item(lambda: None, b'x')...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for sep in (b',', bytearray(b',')):")

# extend: the bytes go where the end was.
try:
    for label, action in (('grown', lambda b: b.extend(b'y' * 20)), ('emptied', lambda b: b.clear()), ('shortened', lambda b: b.__delitem__(slice(3, None))), ('the same', lambda b: None)):
        try: b = bytearray(b'x' * 10)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: b = bytearray(b'x' * 10)")
        try: b.extend(Item(lambda: action(b), b'ABC'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: b.extend(Item(lambda: action(b), b'ABC'))")
        try: print('extend,', 'label [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'action=' + (repr(action) if type(action) in (str, int, float, bytes, bool, type(None)) or (type(action) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in action)) else action.__name__ if type(action) is type else type(action).__name__) + '] =>', label)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: label')
        try: print('bytes(b) [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'action=' + (repr(action) if type(action) in (str, int, float, bytes, bool, type(None)) or (type(action) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in action)) else action.__name__ if type(action) is type else type(action).__name__) + '] =>', bytes(b))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bytes(b)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for label, action in (('grown', lambda b: b.extend(b'y' * 20)), ('emp...")
try: b = bytearray(b'abc')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: b = bytearray(b'abc')")
try: b.extend(b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b.extend(b)')
try: print(b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b')
try: b = bytearray(b'abc')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: b = bytearray(b'abc')")
try: t('extend with a view of itself', lambda: b.extend(memoryview(b)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('extend with a view of itself', lambda: b.extend(memoryview(b)))")
try:
    for label, action in (('grown', lambda b: b.extend(b'y' * 20)), ('emptied', lambda b: b.clear())):
        try: b = bytearray(b'x' * 10)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: b = bytearray(b'x' * 10)")
        try: t('slice, ' + label, lambda: b.__setitem__(slice(2, 4), Item(lambda: action(b), b'ABC')) or bytes(b))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('slice, ' + label, lambda: b.__setitem__(slice(2, 4), Item(lambda: ...")
        try: b = bytearray(b'x' * 10)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: b = bytearray(b'x' * 10)")
        try: t('+=, ' + label, lambda: b.__iadd__(Item(lambda: action(b), b'ABC')) and bytes(b))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('+=, ' + label, lambda: b.__iadd__(Item(lambda: action(b), b'ABC'))...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for label, action in (('grown', lambda b: b.extend(b'y' * 20)), ('emp...")
