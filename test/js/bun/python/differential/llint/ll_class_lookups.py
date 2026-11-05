# What is found in a class, its bases and its metaclass, for many classes and many names at once, while the classes change, come and go.
import gc


def found_by_hand(cls, name):
    for k in cls.__mro__:
        if name in k.__dict__:
            return k.__dict__[name]
    return 'nothing'


state = 12345


def rand(n):
    global state
    state = (state * 1103515245 + 12345) % (1 << 31)
    return (state >> 8) % n


def made(*parts):
    return ''.join(parts)


print('--- more classes and names than anything remembers')
roots = [type('Root%d' % i, (), {'r%d' % j: ('root', i, j) for j in range(40)}) for i in range(12)]
middles = [type('Middle%d' % i, (roots[i % 12],), {'m%d' % j: ('middle', i, j) for j in range(30)}) for i in range(60)]
leaves = [type('Leaf%d' % i, (middles[i % 60], roots[(i + 5) % 12]), {'l%d' % j: ('leaf', i, j) for j in range(20)}) for i in range(240)]
classes = roots + middles + leaves
names = ['r%d' % j for j in range(44)] + ['m%d' % j for j in range(33)] + ['l%d' % j for j in range(22)]
instances = [cls() for cls in classes]
wrong = 0
checked = 0
changes = 0
for step in range(120000):
    which = rand(len(classes))
    cls = classes[which]
    name = names[rand(len(names))]
    if not step % 3:
        name = made(name[:1], name[1:])
    action = rand(100)
    if action < 3:
        setattr(cls, name, ('set', step))
        changes += 1
    elif action < 5:
        if name in cls.__dict__:
            delattr(cls, name)
            changes += 1
    expected = found_by_hand(cls, name)
    checked += 1
    if getattr(cls, name, 'nothing') is not expected and getattr(cls, name, 'nothing') != expected:
        wrong += 1
    if getattr(instances[which], name, 'nothing') != expected:
        wrong += 1
print(checked, changes, wrong)

print('--- what is not there, and then is')


class A:
    pass


class B(A):
    pass


class C(B):
    pass


c = C()


def read(o):
    try:
        return o.late
    except AttributeError as e:
        return str(e)


for where in (A, B, C, B, A):
    print([read(c) for _ in range(3)])
    where.late = where.__name__
    print([read(c) for _ in range(3)], [read(k) for k in (A, B, C)])
    del where.late
print([read(c) for _ in range(3)])
A.late = 'A'
C.late = 'C'
print(read(c), read(B()), read(A()))
del C.late
print(read(c))
del A.late

print('--- other bases')


class X:
    who = 'X'
    only_x = 1


class Y:
    who = 'Y'
    only_y = 2


class D(X):
    pass


class E(D):
    pass


e = E()
for bases in ((Y,), (X, Y), (Y, X), (X,)):
    print(e.who, E.who, getattr(e, 'only_x', None), getattr(e, 'only_y', None))
    D.__bases__ = bases
    print(e.who, E.who, getattr(e, 'only_x', None), getattr(e, 'only_y', None), [k.__name__ for k in E.__mro__])

print('--- another class for the object')
e.__class__ = Y
print(e.who, getattr(e, 'only_x', None), getattr(e, 'only_y', None))
e.__class__ = E
print(e.who, getattr(e, 'only_x', None), getattr(e, 'only_y', None))

print('--- the metaclass')


class Meta(type):
    from_meta = 'meta'

    def method_of_meta(cls):
        return 'method of meta on ' + cls.__name__


class WithMeta(metaclass=Meta):
    pass


class Derived(WithMeta):
    pass


print(Derived.from_meta, Derived.method_of_meta(), getattr(Derived(), 'from_meta', 'not for instances'))
Meta.from_meta = 'changed'
WithMeta.from_meta = 'of the class'
print(Derived.from_meta, WithMeta.from_meta)
del WithMeta.from_meta
print(Derived.from_meta)
del Meta.from_meta
print(getattr(Derived, 'from_meta', 'gone'))

print('--- special methods come and go')


class S:
    pass


s = S()
for turn in range(3):
    for text in ('len(s)', 's[1]', 's + 1', 'bool(s)', 'repr(s)[:3]', 'hash(s) == 7', 's()', 'list(s)', '1 in s'):
        try:
            print(text, eval(text), end='; ')
        except TypeError as error:
            print(text, 'TypeError', end='; ')
    print()
    if turn == 0:
        S.__len__ = lambda self: 3
        S.__getitem__ = lambda self, i: i * 2 if i < 3 else [][1]
        S.__add__ = lambda self, other: 'added'
        S.__repr__ = lambda self: 'repr of S'
        S.__hash__ = lambda self: 7
        S.__call__ = lambda self: 'called'
        S.__contains__ = lambda self, x: 'yes'
    elif turn == 1:
        for name in ('__len__', '__getitem__', '__add__', '__repr__', '__hash__', '__call__', '__contains__'):
            delattr(S, name)

print('--- classes that come and go: a new one has nothing of an old one')
seen = set()
for turn in range(3000):
    T = type('T', (), {'a%d' % (turn % 7): turn})
    t = T()
    got = tuple(getattr(t, 'a%d' % j, None) for j in range(7))
    seen.add(tuple(x is not None for x in got))
    if [x for x in got if x is not None] != [turn]:
        print('wrong', turn, got)
    del T, t
    if not turn % 500:
        gc.collect()
print(len(seen))

print('--- values that come and go')


class Holder:
    pass


class Noisy:
    count = 0

    def __del__(self):
        Noisy.count += 1


h = Holder()
for turn in range(200):
    Holder.value = Noisy()
    assert h.value is Holder.value
    if not turn % 50:
        gc.collect()
del Holder.value
gc.collect()
print(Noisy.count, getattr(h, 'value', 'gone'))

print('--- what the setters of a class put into its dict')


class Annotated:
    __annotations__ = {'a': int}


class MoreAnnotated(Annotated):
    pass


one, two = Annotated(), MoreAnnotated()
print(one.__annotations__, two.__annotations__)
Annotated.__annotations__ = {'b': str}
print(one.__annotations__, two.__annotations__, Annotated.__dict__['__annotations__'])
del Annotated.__annotations__
print(getattr(one, '__annotations__', 'gone'), getattr(two, '__annotations__', 'gone'), '__annotations__' in Annotated.__dict__)


class WithAnnotate:
    x: int

    def __annotate__(format):
        return {'z': 1}


three = WithAnnotate()
print(three.__annotate__.__name__)
WithAnnotate.__annotations__ = {}
print(getattr(three, '__annotate__', 'gone'), '__annotate__' in WithAnnotate.__dict__)


class Plain:
    'the doc'


four = Plain()
for name, values in (('__doc__', ('other doc', None)), ('__module__', ('elsewhere', 'here')), ('__abstractmethods__', (frozenset(), {'m'})),
                     ('__type_params__', ((), ())), ('__annotate__', (None, lambda format: {'q': 2}))):
    for value in values:
        before = getattr(four, name, 'nothing')
        setattr(Plain, name, value)
        after = getattr(four, name, 'nothing')
        print(name, before if not callable(before) else 'callable', '->', after if not callable(after) else 'callable')

print('--- keys that are no strs, and act when they are asked')
asked = []
holder = {}


class Key:
    def __init__(self, text, action=None):
        self.text = text
        self.action = action

    def __hash__(self):
        return hash(self.text)

    def __eq__(self, other):
        asked.append(other)
        if self.action:
            self.action()
        return self.text == other


def changes(which, name):
    def change():
        cls = holder.get(which)
        if cls is not None:
            setattr(cls, name, len(asked))
    return change


def removes(which, name):
    def remove():
        cls = holder.get(which)
        if cls is not None and name in cls.__dict__:
            delattr(cls, name)
    return remove


T = holder['T'] = type('T', (), {Key('attr', changes('T', 'other')): 'by key', 'plain': 1})


class U(T):
    pass


t, u = T(), U()
print(t.attr, u.attr, T.attr, U.attr, len(asked) > 0)
count = len(asked)
print(t.attr, u.attr, len(asked) > count, t.plain, u.plain)
L = holder['L'] = type('L', (), {Key('__len__', changes('L', 'z')): lambda self: 5})
try:
    print(len(L()), len(L()))
except TypeError as error:
    print('TypeError', error)


class Raises:
    def __hash__(self):
        return hash('boom')

    def __eq__(self, other):
        raise RuntimeError('no')


R = type('R', (), {Raises(): 1})
r = R()
print(getattr(r, 'boom', 'absent'), getattr(r, 'boom', 'absent'))
R.boom2 = 3
print(r.boom2, getattr(r, 'boom', 'absent'))
W = holder['W'] = type('W', (), {Key('q', removes('W', 'victim')): 1, 'victim': [1, 2, 3]})
w = W()
print(w.victim)
print(w.q, getattr(w, 'victim', 'gone'))
gc.collect()
print(getattr(w, 'victim', 'gone'))

print('--- threads')
import threading


def worker(number, wrong):
    mine = [type('Mine%d_%d' % (number, i), (roots[i % 12],), {'own': (number, i)}) for i in range(40)]
    for turn in range(300):
        for i, cls in enumerate(mine):
            if cls.own != (number, i) or cls().own != (number, i) or getattr(cls, 'shared', None) is None:
                wrong.append((number, turn, i))
            if not (turn + i) % 50:
                cls.own = (number, i)


for root in roots:
    root.shared = 0
wrong = []
threads = [threading.Thread(target=worker, args=(number, wrong)) for number in range(4)]
for thread in threads:
    thread.start()
for turn in range(200):
    roots[turn % 12].shared = turn
for thread in threads:
    thread.join()
print(wrong)

print('--- names of all lengths, made anew each time')


class Long:
    pass


for length in (1, 99, 100, 101, 5000):
    name = 'n' * length
    setattr(Long, name, length)
    print(length, [getattr(Long(), made('n' * (length - 1), 'n')) for _ in range(3)], [getattr(Long, name) for _ in range(3)], getattr(Long, 'm' + 'n' * (length - 1), 'nothing'))
    setattr(Long, made(name), -length)
    print([getattr(Long(), name) for _ in range(2)])
    delattr(Long, made(name))
    print(getattr(Long(), name, 'gone'), getattr(Long, made(name), 'gone'))
