# What CPython's test_builtin, test_list, test_dict, test_sort, test_float and test_int ask of the built-in types.
try: import warnings, pickle, sys, collections
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import warnings, pickle, sys, collections')
try:
    def attempt(thunk):
        try:
            return thunk()
        except BaseException as e:
            return type(e).__name__ + ": " + str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def attempt(thunk):')
try:
    def warned(thunk):
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            r = attempt(thunk)
        return r, [(x.category.__name__, str(x.message)) for x in w]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def warned(thunk):')

# keywords given to a subclass
try:
    for base in (float, filter, reversed, list, tuple, set, frozenset):
        class Plain(base): pass
        class WithInit(base):
            def __init__(self, *args, newarg=None): self.newarg = newarg
        class WithNew(base):
            def __new__(cls, *args, newarg=None):
                self = super().__new__(cls, *args)
                self.newarg = newarg
                return self
        try: args = {float: (1.5,), filter: (None, [1]), reversed: ([1, 2],)}.get(base, ([1, 2],))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: args = {float: (1.5,), filter: (None, [1]), reversed: ([1, 2],)}.get(...')
        try: print('base.__name__ [' + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + '] =>', base.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: base.__name__')
        try: print('attempt(lambda: base(*args, newarg=3)) [' + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + '] =>', attempt(lambda: base(*args, newarg=3)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: base(*args, newarg=3))')
        try: print('base.__name__ [' + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + '] =>', base.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: base.__name__')
        try: print('attempt(lambda: Plain(*args, newarg=3)) [' + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + '] =>', attempt(lambda: Plain(*args, newarg=3)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: Plain(*args, newarg=3))')
        try: print('base.__name__ [' + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + '] =>', base.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: base.__name__')
        try: print('attempt(lambda: WithInit(*args, newarg=3).newarg) [' + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + '] =>', attempt(lambda: WithInit(*args, newarg=3).newarg))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: WithInit(*args, newarg=3).newarg)')
        try: print('base.__name__ [' + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + '] =>', base.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: base.__name__')
        try: print('attempt(lambda: WithNew(*args, newarg=3).newarg) [' + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + '] =>', attempt(lambda: WithNew(*args, newarg=3).newarg))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: WithNew(*args, newarg=3).newarg)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for base in (float, filter, reversed, list, tuple, set, frozenset):')

# conversions
try:
    class IntSub(int): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class IntSub(int): pass')
try:
    class BadIndex:
        def __index__(self): return IntSub(7)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadIndex:')
try:
    class BadIndexBool:
        def __index__(self): return True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadIndexBool:')
try:
    class BadInt:
        def __int__(self): return IntSub(8)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadInt:')
try: import operator
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import operator')
try: print(warned(lambda: operator.index(BadIndex())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warned(lambda: operator.index(BadIndex()))')
try: print(warned(lambda: operator.index(BadIndexBool())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warned(lambda: operator.index(BadIndexBool()))')
try: print(warned(lambda: int(BadInt())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warned(lambda: int(BadInt()))')
try: print(warned(lambda: [1, 2, 3, 4, 5, 6, 7, 8][BadIndex()]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warned(lambda: [1, 2, 3, 4, 5, 6, 7, 8][BadIndex()])')
try: print(warned(lambda: bin(BadIndex())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warned(lambda: bin(BadIndex()))')
try:
    class FloatSub(float):
        def __float__(self): return 42.0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class FloatSub(float):')
try:
    class FloatSub2(float):
        def __float__(self): return FloatSub(3.0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class FloatSub2(float):')
try: print('warned(lambda: float(FloatSub(1.0))) =>', warned(lambda: float(FloatSub(1.0))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warned(lambda: float(FloatSub(1.0)))')
try: print('warned(lambda: float(FloatSub2(1.0))) =>', warned(lambda: float(FloatSub2(1.0))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warned(lambda: float(FloatSub2(1.0)))')
try: print('warned(lambda: float.from_number(FloatSub(1.0))) =>', warned(lambda: float.from_number(FloatSub(1.0))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warned(lambda: float.from_number(FloatSub(1.0)))')
try: print('warned(lambda: type(float.from_number(FloatSub2(1.0)))) =>', warned(lambda: type(float.from_number(FloatSub2(1.0)))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warned(lambda: type(float.from_number(FloatSub2(1.0))))')
try: x = 1.5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = 1.5')
try: print('float.from_number(x) is x =>', float.from_number(x) is x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: float.from_number(x) is x')
try: print('attempt(lambda: float.from_number("1")) =>', attempt(lambda: float.from_number("1")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: float.from_number("1"))')
try: print('attempt(lambda: float(b"\\xe9")) =>', attempt(lambda: float(b"\xe9")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: float(b"\\xe9"))')
try: print('attempt(lambda: float(b"1\\xe9")) =>', attempt(lambda: float(b"1\xe9")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: float(b"1\\xe9"))')
try: import math
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import math')
try: print('math.sqrt(FloatSub(4.0)) =>', math.sqrt(FloatSub(4.0)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: math.sqrt(FloatSub(4.0))')
try: print('warned(lambda: math.sqrt(FloatSub2(4.0))) =>', warned(lambda: math.sqrt(FloatSub2(4.0))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warned(lambda: math.sqrt(FloatSub2(4.0)))')
try: print('warned(lambda: ~True) =>', warned(lambda: ~True))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warned(lambda: ~True)')
try: print('warned(lambda: ~False) =>', warned(lambda: ~False))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warned(lambda: ~False)')

# len
try:
    class L:
        def __init__(self, n): self.n = n
        def __len__(self): return self.n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class L:')
try:
    for n in (-1, -(1 << 100), 1 << 100, sys.maxsize + 1, 1.5, "a", True, IntSub(3), BadIndex()):
        try: print('repr(n) if not isinstance(n, BadIndex) else "BadIndex" [' + 'n=' + (repr(n) if type(n) in (str, int, float, bytes, bool, type(None)) or (type(n) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in n)) else n.__name__ if type(n) is type else type(n).__name__) + '] =>', repr(n) if not isinstance(n, BadIndex) else "BadIndex")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(n) if not isinstance(n, BadIndex) else "BadIndex"')
        try: print('warned(lambda: len(L(n))) [' + 'n=' + (repr(n) if type(n) in (str, int, float, bytes, bool, type(None)) or (type(n) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in n)) else n.__name__ if type(n) is type else type(n).__name__) + '] =>', warned(lambda: len(L(n))))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warned(lambda: len(L(n)))')
        try: print('warned(lambda: bool(L(n))) [' + 'n=' + (repr(n) if type(n) in (str, int, float, bytes, bool, type(None)) or (type(n) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in n)) else n.__name__ if type(n) is type else type(n).__name__) + '] =>', warned(lambda: bool(L(n))))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warned(lambda: bool(L(n)))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for n in (-1, -(1 << 100), 1 << 100, sys.maxsize + 1, 1.5, "a", True,...')

# sort
try:
    def sort_with(mutate):
        class C:
            def __init__(self, i): self.i = i
            def __lt__(self, other):
                mutate()
                return self.i < other.i
        return C
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sort_with(mutate):')
try: data = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: data = []')
try:
    for name, mutate in (("append-pop", lambda: (data.append(3), data.pop())), ("append-clear", lambda: (data.append(3), data.clear())),
                         ("append", lambda: data.append(3)), ("nothing", lambda: None), ("clear", lambda: data.clear()), ("extend-del", lambda: (data.extend([1, 2]), data.__delitem__(slice(None)))),
                         ("read", lambda: len(data)), ("imul", lambda: data.__imul__(2))):
        try: C = sort_with(mutate)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C = sort_with(mutate)')
        try: data[:] = [C(i) for i in (3, 1, 2)]
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: data[:] = [C(i) for i in (3, 1, 2)]')
        try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'mutate=' + (repr(mutate) if type(mutate) in (str, int, float, bytes, bool, type(None)) or (type(mutate) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in mutate)) else mutate.__name__ if type(mutate) is type else type(mutate).__name__) + '] =>', name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
        try: print('attempt(lambda: data.sort()) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'mutate=' + (repr(mutate) if type(mutate) in (str, int, float, bytes, bool, type(None)) or (type(mutate) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in mutate)) else mutate.__name__ if type(mutate) is type else type(mutate).__name__) + '] =>', attempt(lambda: data.sort()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: data.sort())')
        try: print('[c.i for c in data] [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'mutate=' + (repr(mutate) if type(mutate) in (str, int, float, bytes, bool, type(None)) or (type(mutate) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in mutate)) else mutate.__name__ if type(mutate) is type else type(mutate).__name__) + '] =>', [c.i for c in data])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.i for c in data]')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name, mutate in (("append-pop", lambda: (data.append(3), data.pop...')
try: nums = [3, 1, 2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nums = [3, 1, 2]')
try: print('attempt(lambda: nums.sort(key=lambda v: (nums.append(1), nums.pop(), ... =>', attempt(lambda: nums.sort(key=lambda v: (nums.append(1), nums.pop(), v)[2])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: nums.sort(key=lambda v: (nums.append(1), nums.pop(), ...')
try: print('nums =>', nums)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nums')
try: fl = [3.5, 1.5, 2.5]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fl = [3.5, 1.5, 2.5]')
try: print('attempt(lambda: fl.sort(key=lambda v: (fl.append(1.0), fl.pop(), v)[2])) =>', attempt(lambda: fl.sort(key=lambda v: (fl.append(1.0), fl.pop(), v)[2])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: fl.sort(key=lambda v: (fl.append(1.0), fl.pop(), v)[2]))')
try: print('fl =>', fl)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fl')

# comparison of lists that change
try:
    class X:
        def __eq__(self, other):
            list2.clear()
            return NotImplemented
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class X:')
try:
    class Y:
        def __eq__(self, other):
            list1.clear()
            return NotImplemented
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Y:')
try:
    class Z:
        def __eq__(self, other):
            list3.clear()
            return NotImplemented
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Z:')
try: list1 = [X()]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list1 = [X()]')
try: list2 = [Y()]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list2 = [Y()]')
try: print(list1 == list2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list1 == list2')
try: list3 = [Z()]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list3 = [Z()]')
try: list4 = [1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list4 = [1]')
try: print(list3 == list4)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list3 == list4')
try: list3 = [Z()]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list3 = [Z()]')
try: print(list3 != list4)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list3 != list4')

# reversed iterators of lists
try: orig = [4, 5, 6, 7]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: orig = [4, 5, 6, 7]')
try: it = reversed(orig)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it = reversed(orig)')
try:
    for step in range(6):
        try: r = it.__reduce__()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = it.__reduce__()')
        try: print('step [' + 'step=' + (repr(step) if type(step) in (str, int, float, bytes, bool, type(None)) or (type(step) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in step)) else step.__name__ if type(step) is type else type(step).__name__) + '] =>', step)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: step')
        try: print('r[0].__name__ [' + 'step=' + (repr(step) if type(step) in (str, int, float, bytes, bool, type(None)) or (type(step) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in step)) else step.__name__ if type(step) is type else type(step).__name__) + '] =>', r[0].__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r[0].__name__')
        try: print('r[1:] [' + 'step=' + (repr(step) if type(step) in (str, int, float, bytes, bool, type(None)) or (type(step) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in step)) else step.__name__ if type(step) is type else type(step).__name__) + '] =>', r[1:])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r[1:]')
        try: print('type(pickle.loads(pickle.dumps(it))).__name__ [' + 'step=' + (repr(step) if type(step) in (str, int, float, bytes, bool, type(None)) or (type(step) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in step)) else step.__name__ if type(step) is type else type(step).__name__) + '] =>', type(pickle.loads(pickle.dumps(it))).__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(pickle.loads(pickle.dumps(it))).__name__')
        try: next(it, None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(it, None)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for step in range(6):')

# reversed iterators of dicts
try: d = {f"k{i}": i for i in range(1000)}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = {f"k{i}": i for i in range(1000)}')
try:
    for i in range(1, 1000): del d[f"k{i}"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(1, 1000): del d[f"k{i}"]')
try: its = (reversed(d), reversed(d.keys()), reversed(d.values()), reversed(d.items()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: its = (reversed(d), reversed(d.keys()), reversed(d.values()), reverse...')
try: d.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.clear()')
try: d["k0"] = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d["k0"] = 0')
try: print([list(i) for i in its])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [list(i) for i in its]')
try: d = dict.fromkeys(range(10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = dict.fromkeys(range(10))')
try:
    for i in range(7): del d[i]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(7): del d[i]')
try: its = (reversed(d), reversed(d.keys()), reversed(d.values()), reversed(d.items()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: its = (reversed(d), reversed(d.keys()), reversed(d.values()), reverse...')
try: print([next(i) for i in its])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [next(i) for i in its]')
try: d.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.clear()')
try: d.update(dict.fromkeys(range(10)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.update(dict.fromkeys(range(10)))')
try:
    for i in range(3, 10): del d[i]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(3, 10): del d[i]')
try: print([attempt(lambda: list(i)) for i in its])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [attempt(lambda: list(i)) for i in its]')

# update
try:
    def notes(thunk):
        try:
            thunk()
        except BaseException as e:
            return type(e).__name__, str(e), getattr(e, "__notes__", None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def notes(thunk):')
try: print(notes(lambda: {}.update([object() for _ in range(3)])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: notes(lambda: {}.update([object() for _ in range(3)]))')
try:
    def badgen():
        yield "key"
        raise TypeError("oops")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def badgen():')
try: print(notes(lambda: dict([badgen() for _ in range(3)])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: notes(lambda: dict([badgen() for _ in range(3)]))')
try: print(notes(lambda: dict([(1, 2), 5])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: notes(lambda: dict([(1, 2), 5]))')
try: print(notes(lambda: dict([(1, 2), (1, 2, 3)])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: notes(lambda: dict([(1, 2), (1, 2, 3)]))')
try:
    def badgen2():
        yield "key"
        raise ValueError("oops")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def badgen2():')
try: print(notes(lambda: dict([badgen2()])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: notes(lambda: dict([badgen2()]))')
try:
    class E:
        def __hash__(self): return 0
        def __eq__(self, o):
            other.clear()
            return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E:')
try: other = dict([(i, 0) for i in range(1, 1337)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: other = dict([(i, 0) for i in range(1, 1337)])')
try: other[E()] = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: other[E()] = 0')
try: d = {E(): 0, 1: 1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = {E(): 0, 1: 1}')
try: print(attempt(lambda: d.update(other)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attempt(lambda: d.update(other))')

# classes
try: print("attempt(lambda: type('A\\udcdcB', (), {})) =>", attempt(lambda: type('A\udcdcB', (), {})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt(lambda: type('A\\udcdcB', (), {}))")
try: print("attempt(lambda: type('A\\x00B', (), {})) =>", attempt(lambda: type('A\x00B', (), {})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt(lambda: type('A\\x00B', (), {}))")
try: print("attempt(lambda: type('A', (), {'__doc__': 'x\\udcdcy'})) =>", attempt(lambda: type('A', (), {'__doc__': 'x\udcdcy'})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt(lambda: type('A', (), {'__doc__': 'x\\udcdcy'}))")
try: A = type('C', (), {})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: A = type('C', (), {})")
try: print("attempt(lambda: setattr(A, '__name__', 'A\\udcdcB')) =>", attempt(lambda: setattr(A, '__name__', 'A\udcdcB')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt(lambda: setattr(A, '__name__', 'A\\udcdcB'))")
try: print('A.__name__ =>', A.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__name__')
try: A.__doc__ = 'x\udcdcy'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: A.__doc__ = 'x\\udcdcy'")
try: print(ascii(A.__doc__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ascii(A.__doc__)')
try: print(type('\U0001f40d', (), {'__doc__': '\U0001f40d'}).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: type('\\U0001f40d', (), {'__doc__': '\\U0001f40d'}).__name__")
try: od = collections.OrderedDict([('a', 1), ('b', 2)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: od = collections.OrderedDict([('a', 1), ('b', 2)])")
try: od.move_to_end('a')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: od.move_to_end('a')")
try: C = type('C', (), od)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: C = type('C', (), od)")
try: print('[k for k in C.__dict__ if len(k) == 1] =>', [k for k in C.__dict__ if len(k) == 1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [k for k in C.__dict__ if len(k) == 1]')
try: print('list(dict(od)) =>', list(dict(od)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(dict(od))')
try: print('list({**od}) =>', list({**od}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list({**od})')
try: print('list(od.copy()) =>', list(od.copy()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(od.copy())')
try:
    class RevDict(dict):
        def __iter__(self): return reversed(list(super().__iter__()))
        def keys(self): return list(self)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class RevDict(dict):')
try: rd = RevDict(a=1, b=2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: rd = RevDict(a=1, b=2)')
try: print('list(dict(rd)) =>', list(dict(rd)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(dict(rd))')
try: print('list({**rd}) =>', list({**rd}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list({**rd})')
try: print("[k for k in type('C', (), rd).__dict__ if len(k) == 1] =>", [k for k in type('C', (), rd).__dict__ if len(k) == 1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: [k for k in type('C', (), rd).__dict__ if len(k) == 1]")
try:
    for t in (int, float, str, bytes, list, dict, tuple, object, type, A, bool, complex, range, bytearray, type(None), set, frozenset, slice, memoryview, property):
        try: print('t.__name__ [' + 't=' + (repr(t) if type(t) in (str, int, float, bytes, bool, type(None)) or (type(t) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in t)) else t.__name__ if type(t) is type else type(t).__name__) + '] =>', t.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t.__name__')
        try: print('bool(t.__flags__ & (1 << 8)) [' + 't=' + (repr(t) if type(t) in (str, int, float, bytes, bool, type(None)) or (type(t) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in t)) else t.__name__ if type(t) is type else type(t).__name__) + '] =>', bool(t.__flags__ & (1 << 8)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(t.__flags__ & (1 << 8))')
        try: print('bool(t.__flags__ & (1 << 14)) [' + 't=' + (repr(t) if type(t) in (str, int, float, bytes, bool, type(None)) or (type(t) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in t)) else t.__name__ if type(t) is type else type(t).__name__) + '] =>', bool(t.__flags__ & (1 << 14)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(t.__flags__ & (1 << 14))')
        try: print('bool(t.__flags__ & (1 << 9)) [' + 't=' + (repr(t) if type(t) in (str, int, float, bytes, bool, type(None)) or (type(t) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in t)) else t.__name__ if type(t) is type else type(t).__name__) + '] =>', bool(t.__flags__ & (1 << 9)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(t.__flags__ & (1 << 9))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for t in (int, float, str, bytes, list, dict, tuple, object, type, A,...')
