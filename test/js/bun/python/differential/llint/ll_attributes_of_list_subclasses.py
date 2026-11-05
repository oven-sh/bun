# Attributes and methods of instances of classes derived from list, each read from one place many times.
import copy
import pickle


def attempt(function, *args):
    try:
        return function(*args)
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


class L(list):
    flag = False
    def method(self, x=0): return ('L.method', len(self), x)
    @classmethod
    def cm(cls): return cls.__name__
    @staticmethod
    def sm(): return 'sm'
    @property
    def prop(self): return ('prop', len(self))


class M(list):
    flag = True
    def method(self, x=0): return ('M.method', len(self), x)
    def append(self, x): list.append(self, ('M', x))


class Derived(L):
    def method(self, x=0): return ('Derived.method', len(self), x)


class Slotted(list):
    __slots__ = ('a', 'b')
    def method(self, x=0): return ('Slotted.method', len(self), x)


class Hooked(list):
    def __getattr__(self, name): return 'hook ' + name


def flag(o): return o.flag
def method(o): return o.method(1)
def read_method(o): return o.method
def cm(o): return o.cm()
def sm(o): return o.sm()
def prop(o): return o.prop
def own(o): return o.own
def append(o, x): o.append(x)
def length(o): return o.__len__()
def cls(o): return o.__class__
def dct(o): return o.__dict__
def a(o): return o.a


print('--- contents of every kind: the same class, other ways of storing the items')
contents = [[], [1], [1, 2, 3], [1.5], [1.5, 2.5], ['a'], [1, 'a'], [None], list(range(100)), [1, 2.5], [[]], [2 ** 70]]
for round in range(2):
    for items in contents:
        o = L(items)
        print(flag(o), method(o), cm(o), sm(o), prop(o), length(o), cls(o).__name__, attempt(own, o), dct(o))

print('--- the items change under the same object')
o = L()
for item in (1, 2, 1.5, 'a', None, [], 2 ** 70):
    append(o, item)
    print(flag(o), method(o), prop(o), o)
del o[:]
print(flag(o), method(o), prop(o), o)
o.extend(range(2000))
print(flag(o), method(o), prop(o), len(o))
o[1000:] = []
o.sort(reverse=True)
print(flag(o), method(o), prop(o), o[:3])

print('--- several classes at one place')
for round in range(3):
    for o in (L([1]), M([1]), Derived([1]), Slotted([1]), Hooked([1]), [1]):
        print(type(o).__name__, attempt(flag, o), attempt(method, o), attempt(cm, o), attempt(prop, o), length(o), cls(o).__name__)
        append(o, 2)
        print(o)

print('--- attributes of its own')
o = L([1])
p = L([1])
print(attempt(own, o), flag(o), method(o))
o.own = 'own'
print(own(o), attempt(own, p), flag(o), method(o), dct(o), dct(p))
o.flag = 'own flag'
print(flag(o), flag(p))
o.method = lambda x: 'own method'
print(method(o), method(p), read_method(o)(1), read_method(p)(1))
del o.method
del o.flag
print(flag(o), method(o), dct(o))
o.__dict__['flag'] = 'through the dict'
print(flag(o), flag(p))
o.__dict__.clear()
print(flag(o), attempt(own, o))
o.__dict__ = {'flag': 'another dict'}
print(flag(o), flag(p))

print('--- the class changes')
o = L([1])
print(flag(o), method(o), cm(o))
L.flag = 'changed'
print(flag(o), flag(Derived()))
L.method = lambda self, x=0: 'changed method'
print(method(o), method(Derived()))
del L.flag
print(attempt(flag, o))
L.flag = property(lambda self: 'a property now')
print(flag(o))
L.flag = False
L.__getattr__ = lambda self, name: 'late hook ' + name
print(flag(o), own(o))
del L.__getattr__
print(flag(o), attempt(own, o))

print('--- the object is given another class')
o = L([1, 2])
for target in (M, L, Derived, M, L):
    o.__class__ = target
    print(cls(o).__name__, flag(o), method(o), type(o).__name__)
    append(o, 0)
print(o)
print(attempt(setattr, o, '__class__', Slotted), attempt(setattr, o, '__class__', list), attempt(setattr, o, '__class__', int))

print('--- slots')
s = Slotted([1])
print(attempt(a, s), method(s), attempt(dct, s))
s.a = 'a'
print(a(s), attempt(a, Slotted()), attempt(setattr, s, 'c', 1))
del s.a
print(attempt(a, s))

print('--- what lists do goes on')
o = L([3, 1, 2])
o.own = 1
print(sorted(o), o + [4], o * 2, o[1:], o == [3, 1, 2], list(reversed(o)), 3 in o, o.index(1), repr(o), type(o[:]).__name__, type(o + o).__name__, type(o.copy()).__name__)
q = copy.copy(o)
print(type(q).__name__, q, q.own, q is o)
q = copy.deepcopy(o)
print(type(q).__name__, q, q.own)
q = pickle.loads(pickle.dumps(o))
print(type(q).__name__, q, q.own, method(q))
first, *rest = o
print(first, rest, [x for x in o], max(o), sum(o), len(o), bool(L()), bool(o))
print(isinstance(o, list), issubclass(L, list), L.__mro__[1].__name__, L.__bases__[0].__name__)
