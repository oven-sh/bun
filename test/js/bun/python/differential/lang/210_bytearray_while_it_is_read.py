# A bytearray cannot be resized by what runs in the middle of one of its own methods.
def t(label, f):
    try:
        print(label, 'ok', f())
    except Exception as e:
        print(label, type(e).__name__, e)

def make():
    return bytearray(b'abc-def-ghi' * 8)

class Index:
    def __init__(self, ba, value=0): self.ba, self.value = ba, value
    def __index__(self):
        self.ba.clear()
        return self.value

class Buffer:
    def __init__(self, ba, data=b'-'): self.ba, self.data = ba, data
    def __buffer__(self, flags):
        self.ba.clear()
        return memoryview(self.data)

for name in ('find', 'rfind', 'index', 'rindex', 'count', 'startswith', 'endswith', 'split', 'rsplit', 'partition', 'rpartition', 'removeprefix', 'removesuffix', 'strip', 'lstrip', 'rstrip', 'join'):
    ba = make()
    argument = [Buffer(ba)] if name == 'join' else Buffer(ba)
    t(name + ' __buffer__', lambda: getattr(ba, name)(argument))
    print('   ', len(ba))
for name in ('find', 'rfind', 'index', 'rindex', 'count', 'startswith', 'endswith'):
    ba = make()
    t(name + ' start', lambda: getattr(ba, name)(b'-', Index(ba)))
    print('   ', len(ba))
for name in ('find', 'rfind', 'index', 'rindex', 'count'):
    ba = make()
    t(name + ' byte', lambda: getattr(ba, name)(Index(ba, 45)))
    print('   ', len(ba))
for name in ('split', 'rsplit'):
    ba = make()
    t(name + ' maxsplit', lambda: getattr(ba, name)(b'-', Index(ba, 1)))
    print('   ', len(ba))
ba = make()
t('in, __index__', lambda: Index(ba, 45) in ba)
ba = make()
t('in, __buffer__', lambda: Buffer(ba) in ba)

class Repr:
    def __init__(self, ba): self.ba = ba
    def __repr__(self):
        self.ba.clear()
        return 'cleared'
    def __bytes__(self):
        self.ba.clear()
        return b'cleared'
ba = bytearray(b'%a and %a' + b' ' * 100)
t('%a', lambda: (ba % (Repr(ba), 1)).strip())
ba = bytearray(b'%b and %b' + b' ' * 100)
t('%b', lambda: (ba % (Repr(ba), b'x')).strip())
ba = bytearray(b'%d' + b' ' * 100)
t('%d', lambda: (ba % Index(ba, 3)).strip())

class Sep(bytes):
    ba = None
    def __len__(self):
        Sep.ba.clear()
        return 1
Sep.ba = ba = make()
t('hex', lambda: ba.hex(Sep(b':')))
class Odd(bytes):
    def __len__(self): return 1
class OddStr(str):
    def __len__(self): return 1
t('hex, empty separator that says 1', lambda: b'ab'.hex(Odd()))
t('hex, empty separator that says 1', lambda: b'ab'.hex(OddStr()))
t('hex, long separator that says 1', lambda: b'ab'.hex(Odd(b'xyz')))

# join: the sequence is read as it is when each item's turn comes.
class Item:
    def __init__(self, action, data): self.action, self.data = action, data
    def __buffer__(self, flags):
        self.action()
        return memoryview(self.data)
for sep in (b',', bytearray(b',')):
    items = [b'a', None, b'c']
    items[1] = Item(lambda: items.append(b'd'), b'x')
    t('join, longer', lambda: sep.join(items))
    items = [b'a', None, b'c']
    items[1] = Item(lambda: items.pop(), b'x')
    t('join, shorter', lambda: sep.join(items))
    items = [b'a', None, b'c']
    items[1] = Item(lambda: items.clear(), b'x')
    t('join, emptied', lambda: sep.join(items))
    items = [b'a', None, b'c']
    items[1] = Item(lambda: items.__setitem__(1, b'z'), b'x')
    t('join, itself replaced', lambda: sep.join(items))
    items = [b'a', None, b'c']
    items[1] = Item(lambda: items.__setitem__(2, b'z'), b'x')
    t('join, the next replaced', lambda: sep.join(items))
    items = [b'a', None, b'c']
    items[1] = Item(lambda: items.__setitem__(0, b'z'), b'x')
    t('join, the one before replaced', lambda: sep.join(items))
    other = bytearray(b'other')
    items = [other, Item(lambda: other.clear(), b'x')]
    t('join, an item resized', lambda: sep.join(items))
    t('join, not bytes', lambda: sep.join([b'a', Item(lambda: None, b'x'), 1]))

# extend: the bytes go where the end was.
for label, action in (('grown', lambda b: b.extend(b'y' * 20)), ('emptied', lambda b: b.clear()), ('shortened', lambda b: b.__delitem__(slice(3, None))), ('the same', lambda b: None)):
    b = bytearray(b'x' * 10)
    b.extend(Item(lambda: action(b), b'ABC'))
    print('extend,', label, bytes(b))
b = bytearray(b'abc'); b.extend(b); print(b)
b = bytearray(b'abc'); t('extend with a view of itself', lambda: b.extend(memoryview(b)))
for label, action in (('grown', lambda b: b.extend(b'y' * 20)), ('emptied', lambda b: b.clear())):
    b = bytearray(b'x' * 10)
    t('slice, ' + label, lambda: b.__setitem__(slice(2, 4), Item(lambda: action(b), b'ABC')) or bytes(b))
    b = bytearray(b'x' * 10)
    t('+=, ' + label, lambda: b.__iadd__(Item(lambda: action(b), b'ABC')) and bytes(b))
