# The type, and classes derived from it.
import _random

R = _random.Random

def show(f, *args, **kw):
    try:
        r = repr(f(*args, **kw))
    except BaseException as e:
        r = '%s: %s' % (type(e).__name__, e)
    print(getattr(f, '__name__', f), [a if isinstance(a, (int, str, type, list)) or a is None else type(a).__name__ for a in args], kw or '', r)

print(sorted(n for n in dir(_random) if not n.startswith('__')), _random.__name__, repr(_random.__doc__))
print(R, R.__name__, R.__qualname__, R.__module__, repr(R.__doc__), R.__bases__, R.__mro__, type(R))
print(sorted(vars(R)))
print(type(R.random).__name__, type(R(1).random).__name__, R.random.__name__, R.random.__qualname__, R.random.__objclass__ is R, repr(R.random))
print(type(R.__init__).__name__, type(R.__new__).__name__)
print(isinstance(R(), R), type(R(1)) is R, repr(R(1)).startswith('<_random.Random object at 0x'))
show(R, 1, 2)
show(R, x=1)
show(R, 1, x=1)
show(R, [])
show(setattr, R, 'x', 1)
show(setattr, R(1), 'x', 1)
show(getattr, R(1), '__dict__')
show(getattr, R(1), 'nothing')
show(delattr, R, 'random')
show(R.random)
show(R.random, 1)
show(R.random, object())
show(R.seed, 'a', 1)
show(R.getstate, None)
show(R.__init__, 1)
show(R.__new__)
show(R.__new__, int)
show(R.__new__, 1)
show(object.__new__, R)
print(R(1) == R(1), bool(R(1)))

fresh = R.__new__(R)
print(fresh.random(), fresh.getrandbits(32), fresh.getstate()[:2], fresh.getstate()[-1])
fresh = R.__new__(R, 1, 2, x=3)
print(fresh.getstate() == (0,) * 625)
print(fresh.__init__(5), fresh.random() == R(5).random())
print(fresh.__init__(), fresh.getstate()[-1])
show(fresh.__init__, 1, 2)
show(fresh.__init__, x=1)

class S(R):
    pass
s = S(5)
print(type(s).__name__, isinstance(s, R), s.random() == R(5).random(), S.__mro__)
s.x = 1
print(s.x, s.__dict__)
show(S, 1, 2)
show(S, x=1)

class WithInit(R):
    def __init__(self, *args, **kw):
        self.args = args
        self.kw = kw
w = WithInit(1, 2, 3, x=4)
print(w.args, w.kw, w.random(), w.getstate()[-1])

class LikeLib(R):
    def __init__(self, x=None):
        self.seed(x)
        self.gauss_next = None
    def seed(self, a=None, version=2):
        if isinstance(a, str):
            a = sum(ord(c) << (8 * i) for i, c in enumerate(a))
        super().seed(a)
        self.gauss_next = None
    def getstate(self):
        return 3, super().getstate(), self.gauss_next
    def setstate(self, state):
        version, internal, self.gauss_next = state
        super().setstate(internal)
l = LikeLib('abc')
print(l.random(), l.getrandbits(10), l.getstate()[0], len(l.getstate()[1]))
l2 = LikeLib(x=7)
print(l2.random() == R(7).random())
st = l.getstate()
a = l.random()
l.setstate(st)
print(l.random() == a)

class WithNew(R):
    def __new__(cls, *args, **kw):
        return super().__new__(cls)
print(WithNew(5).random() == R(5).random())
print(WithNew(5, x=4).random() == R(5).random())
print(WithNew(x=4).getstate()[-1])
show(WithNew, 1, 2)

class Slots(R):
    __slots__ = ('a',)
sl = Slots(1)
sl.a = 5
print(sl.a, sl.random() == R(1).random())
show(setattr, sl, 'b', 1)

class Over(R):
    def random(self):
        return 0.25
print(Over(1).random(), R.random(Over(1)) == R(1).random())

try:
    class Two(R, int):
        pass
except TypeError as e:
    print('TypeError:', e)
class Mixin:
    def hello(self): return 'hello'
class Mixed(Mixin, R):
    pass
print(Mixed(3).hello(), Mixed(3).random() == R(3).random())
