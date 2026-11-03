# A tuple works its hash out once.
try:
    class Key:
        calls = 0
        def __init__(self, value): self.value = value
        def __hash__(self):
            Key.calls += 1
            return hash(self.value)
        def __eq__(self, other): return self.value == other.value
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Key:')

try:
    def calls(f):
        Key.calls = 0
        f()
        return Key.calls
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def calls(f):')

try: t = (Key(1), Key(2), "x", 3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t = (Key(1), Key(2), "x", 3)')
try: print('calls(lambda: hash(t)) =>', calls(lambda: hash(t)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls(lambda: hash(t))')
try: print('calls(lambda: hash(t)) =>', calls(lambda: hash(t)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls(lambda: hash(t))')
try: print('calls(lambda: {t: 1}[t]) =>', calls(lambda: {t: 1}[t]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls(lambda: {t: 1}[t])')
try: print('calls(lambda: t in {t}) =>', calls(lambda: t in {t}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls(lambda: t in {t})')
try: print('hash(t) == hash((1, 2, "x", 3)) =>', hash(t) == hash((1, 2, "x", 3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(t) == hash((1, 2, "x", 3))')
try: nested = (t, (t, t), Key(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nested = (t, (t, t), Key(5))')
try: print('calls(lambda: hash(nested)) =>', calls(lambda: hash(nested)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls(lambda: hash(nested))')
try: print('calls(lambda: hash(nested)) =>', calls(lambda: hash(nested)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls(lambda: hash(nested))')
try: print('calls(lambda: hash((t, Key(6)))) =>', calls(lambda: hash((t, Key(6)))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls(lambda: hash((t, Key(6))))')

# The values are what they always were.
try: print('hash(()) =>', hash(()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(())')
try: print('hash((1,)) =>', hash((1,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash((1,))')
try: print('hash((1, 2)) =>', hash((1, 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash((1, 2))')
try: print('hash((1, 2, 3)) =>', hash((1, 2, 3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash((1, 2, 3))')
try: print('hash(((), ())) =>', hash(((), ())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(((), ()))')
try: print('hash((1.5, None, True)) =>', hash((1.5, None, True)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash((1.5, None, True))')
try: print('hash((-1,)) =>', hash((-1,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash((-1,))')
try: print('hash((2**70,)) =>', hash((2**70,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash((2**70,))')
try: print('hash((1, 2)) == hash((1.0, 2.0)) == hash((True, 2)) =>', hash((1, 2)) == hash((1.0, 2.0)) == hash((True, 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash((1, 2)) == hash((1.0, 2.0)) == hash((True, 2))')
try: print('hash((1, 2)) != hash((2, 1)) =>', hash((1, 2)) != hash((2, 1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash((1, 2)) != hash((2, 1))')

# What cannot be hashed is asked again each time, and nothing is remembered of the attempt.
try:
    class Moody:
        ok = False
        def __hash__(self):
            if not Moody.ok:
                raise TypeError("not now")
            return 7
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Moody:')
try: m = (1, Moody())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m = (1, Moody())')
try:
    for _ in range(2):
        try:
            hash(m)
        except TypeError as e:
            print("TypeError", 'e [' + '_=' + (repr(_) if type(_) in (str, int, float, bytes, bool, type(None)) or (type(_) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in _)) else _.__name__ if type(_) is type else type(_).__name__) + '] =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for _ in range(2):')
try: Moody.ok = True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Moody.ok = True')
try: print('hash(m) == hash((1, 7)) =>', hash(m) == hash((1, 7)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(m) == hash((1, 7))')
try: print('hash(m) == hash(m) =>', hash(m) == hash(m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(m) == hash(m)')
try:
    for bad in ((1, []), ([],), (1, (2, {}))):
        for _ in range(2):
            try:
                hash(bad)
            except TypeError as e:
                print("TypeError", 'e [' + 'bad=' + (repr(bad) if type(bad) in (str, int, float, bytes, bool, type(None)) or (type(bad) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in bad)) else bad.__name__ if type(bad) is type else type(bad).__name__) + ", " + '_=' + (repr(_) if type(_) in (str, int, float, bytes, bool, type(None)) or (type(_) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in _)) else _.__name__ if type(_) is type else type(_).__name__) + '] =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for bad in ((1, []), ([],), (1, (2, {}))):')

# Classes derived from tuple.
try: import collections
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import collections')
try: P = collections.namedtuple("P", "x y")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P = collections.namedtuple("P", "x y")')
try: p = P(Key(1), Key(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p = P(Key(1), Key(2))')
try: print('calls(lambda: hash(p)) =>', calls(lambda: hash(p)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls(lambda: hash(p))')
try: print('calls(lambda: hash(p)) =>', calls(lambda: hash(p)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls(lambda: hash(p))')
try: print('hash(p) == hash((1, 2)) =>', hash(p) == hash((1, 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(p) == hash((1, 2))')
try:
    class T(tuple): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class T(tuple): pass')
try: s = T((Key(1), Key(2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = T((Key(1), Key(2)))')
try: print('calls(lambda: hash(s)) =>', calls(lambda: hash(s)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls(lambda: hash(s))')
try: print('calls(lambda: hash(s)) =>', calls(lambda: hash(s)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls(lambda: hash(s))')
try: print('hash(s) == hash((1, 2)) =>', hash(s) == hash((1, 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(s) == hash((1, 2))')
try:
    class Own(tuple):
        def __hash__(self): return 42
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Own(tuple):')
try: o = Own((Key(1),))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Own((Key(1),))')
try: print('calls(lambda: hash(o)) =>', calls(lambda: hash(o)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls(lambda: hash(o))')
try: print('hash(o) =>', hash(o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(o)')
try: print('calls(lambda: tuple.__hash__(o)) =>', calls(lambda: tuple.__hash__(o)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls(lambda: tuple.__hash__(o))')
try: print('calls(lambda: tuple.__hash__(o)) =>', calls(lambda: tuple.__hash__(o)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls(lambda: tuple.__hash__(o))')
try: print('tuple.__hash__(o) == hash((1,)) =>', tuple.__hash__(o) == hash((1,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tuple.__hash__(o) == hash((1,))')

# Large ones, often.
try: big = tuple(range(200000))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: big = tuple(range(200000))')
try: h = hash(big)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h = hash(big)')
try: print('all(hash(big) == h for _ in range(20000)) =>', all(hash(big) == h for _ in range(20000)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: all(hash(big) == h for _ in range(20000))')
try: print('len({big: 1, tuple(range(200000)): 2}) =>', len({big: 1, tuple(range(200000)): 2}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len({big: 1, tuple(range(200000)): 2})')
try: import copy, pickle
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import copy, pickle')
try: print(hash(copy.deepcopy(big[:50])) == hash(big[:50]) == hash(pickle.loads(pickle.dumps(big[:50]))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(copy.deepcopy(big[:50])) == hash(big[:50]) == hash(pickle.loads(...')
