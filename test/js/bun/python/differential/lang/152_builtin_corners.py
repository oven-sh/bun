# What CPython's test_builtin, test_list, test_dict, test_sort, test_float and test_int ask of the built-in types.
import warnings, pickle, sys, collections
def attempt(thunk):
    try:
        return thunk()
    except BaseException as e:
        return type(e).__name__ + ": " + str(e)
def warned(thunk):
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        r = attempt(thunk)
    return r, [(x.category.__name__, str(x.message)) for x in w]

# keywords given to a subclass
for base in (float, filter, reversed, list, tuple, set, frozenset):
    class Plain(base): pass
    class WithInit(base):
        def __init__(self, *args, newarg=None): self.newarg = newarg
    class WithNew(base):
        def __new__(cls, *args, newarg=None):
            self = super().__new__(cls, *args)
            self.newarg = newarg
            return self
    args = {float: (1.5,), filter: (None, [1]), reversed: ([1, 2],)}.get(base, ([1, 2],))
    print(base.__name__, attempt(lambda: base(*args, newarg=3)))
    print(base.__name__, attempt(lambda: Plain(*args, newarg=3)))
    print(base.__name__, attempt(lambda: WithInit(*args, newarg=3).newarg))
    print(base.__name__, attempt(lambda: WithNew(*args, newarg=3).newarg))

# conversions
class IntSub(int): pass
class BadIndex:
    def __index__(self): return IntSub(7)
class BadIndexBool:
    def __index__(self): return True
class BadInt:
    def __int__(self): return IntSub(8)
import operator
print(warned(lambda: operator.index(BadIndex())))
print(warned(lambda: operator.index(BadIndexBool())))
print(warned(lambda: int(BadInt())))
print(warned(lambda: [1, 2, 3, 4, 5, 6, 7, 8][BadIndex()]))
print(warned(lambda: bin(BadIndex())))
class FloatSub(float):
    def __float__(self): return 42.0
class FloatSub2(float):
    def __float__(self): return FloatSub(3.0)
print(warned(lambda: float(FloatSub(1.0))), warned(lambda: float(FloatSub2(1.0))))
print(warned(lambda: float.from_number(FloatSub(1.0))), warned(lambda: type(float.from_number(FloatSub2(1.0)))))
x = 1.5
print(float.from_number(x) is x, attempt(lambda: float.from_number("1")), attempt(lambda: float(b"\xe9")), attempt(lambda: float(b"1\xe9")))
import math
print(math.sqrt(FloatSub(4.0)), warned(lambda: math.sqrt(FloatSub2(4.0))))
print(warned(lambda: ~True), warned(lambda: ~False))

# len
class L:
    def __init__(self, n): self.n = n
    def __len__(self): return self.n
for n in (-1, -(1 << 100), 1 << 100, sys.maxsize + 1, 1.5, "a", True, IntSub(3), BadIndex()):
    print(repr(n) if not isinstance(n, BadIndex) else "BadIndex", warned(lambda: len(L(n))))
    print(warned(lambda: bool(L(n))))

# sort
def sort_with(mutate):
    class C:
        def __init__(self, i): self.i = i
        def __lt__(self, other):
            mutate()
            return self.i < other.i
    return C
data = []
for name, mutate in (("append-pop", lambda: (data.append(3), data.pop())), ("append-clear", lambda: (data.append(3), data.clear())),
                     ("append", lambda: data.append(3)), ("nothing", lambda: None), ("clear", lambda: data.clear()), ("extend-del", lambda: (data.extend([1, 2]), data.__delitem__(slice(None)))),
                     ("read", lambda: len(data)), ("imul", lambda: data.__imul__(2))):
    C = sort_with(mutate)
    data[:] = [C(i) for i in (3, 1, 2)]
    print(name, attempt(lambda: data.sort()), [c.i for c in data])
nums = [3, 1, 2]
print(attempt(lambda: nums.sort(key=lambda v: (nums.append(1), nums.pop(), v)[2])), nums)
fl = [3.5, 1.5, 2.5]
print(attempt(lambda: fl.sort(key=lambda v: (fl.append(1.0), fl.pop(), v)[2])), fl)

# comparison of lists that change
class X:
    def __eq__(self, other):
        list2.clear()
        return NotImplemented
class Y:
    def __eq__(self, other):
        list1.clear()
        return NotImplemented
class Z:
    def __eq__(self, other):
        list3.clear()
        return NotImplemented
list1 = [X()]; list2 = [Y()]
print(list1 == list2)
list3 = [Z()]; list4 = [1]
print(list3 == list4)
list3 = [Z()]
print(list3 != list4)

# reversed iterators of lists
orig = [4, 5, 6, 7]
it = reversed(orig)
for step in range(6):
    r = it.__reduce__()
    print(step, r[0].__name__, r[1:], type(pickle.loads(pickle.dumps(it))).__name__)
    next(it, None)

# reversed iterators of dicts
d = {f"k{i}": i for i in range(1000)}
for i in range(1, 1000): del d[f"k{i}"]
its = (reversed(d), reversed(d.keys()), reversed(d.values()), reversed(d.items()))
d.clear(); d["k0"] = 0
print([list(i) for i in its])
d = dict.fromkeys(range(10))
for i in range(7): del d[i]
its = (reversed(d), reversed(d.keys()), reversed(d.values()), reversed(d.items()))
print([next(i) for i in its])
d.clear(); d.update(dict.fromkeys(range(10)))
for i in range(3, 10): del d[i]
print([attempt(lambda: list(i)) for i in its])

# update
def notes(thunk):
    try:
        thunk()
    except BaseException as e:
        return type(e).__name__, str(e), getattr(e, "__notes__", None)
print(notes(lambda: {}.update([object() for _ in range(3)])))
def badgen():
    yield "key"
    raise TypeError("oops")
print(notes(lambda: dict([badgen() for _ in range(3)])))
print(notes(lambda: dict([(1, 2), 5])))
print(notes(lambda: dict([(1, 2), (1, 2, 3)])))
def badgen2():
    yield "key"
    raise ValueError("oops")
print(notes(lambda: dict([badgen2()])))
class E:
    def __hash__(self): return 0
    def __eq__(self, o):
        other.clear()
        return False
other = dict([(i, 0) for i in range(1, 1337)]); other[E()] = 0
d = {E(): 0, 1: 1}
print(attempt(lambda: d.update(other)))

# classes
print(attempt(lambda: type('A\udcdcB', (), {})), attempt(lambda: type('A\x00B', (), {})), attempt(lambda: type('A', (), {'__doc__': 'x\udcdcy'})))
A = type('C', (), {})
print(attempt(lambda: setattr(A, '__name__', 'A\udcdcB')), A.__name__)
A.__doc__ = 'x\udcdcy'; print(ascii(A.__doc__))
print(type('\U0001f40d', (), {'__doc__': '\U0001f40d'}).__name__)
od = collections.OrderedDict([('a', 1), ('b', 2)]); od.move_to_end('a')
C = type('C', (), od)
print([k for k in C.__dict__ if len(k) == 1], list(dict(od)), list({**od}), list(od.copy()))
class RevDict(dict):
    def __iter__(self): return reversed(list(super().__iter__()))
    def keys(self): return list(self)
rd = RevDict(a=1, b=2)
print(list(dict(rd)), list({**rd}), [k for k in type('C', (), rd).__dict__ if len(k) == 1])
for t in (int, float, str, bytes, list, dict, tuple, object, type, A, bool, complex, range, bytearray, type(None), set, frozenset, slice, memoryview, property):
    print(t.__name__, bool(t.__flags__ & (1 << 8)), bool(t.__flags__ & (1 << 14)), bool(t.__flags__ & (1 << 9)))
