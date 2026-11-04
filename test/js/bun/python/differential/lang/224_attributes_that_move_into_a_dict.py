# obj.__dict__ of objects in every state an object can be in when a program first asks for it, and what the object and the dict
# have to do with each other from then on.
import copy, gc, pickle, weakref

class Plain:
    pass

class Three:
    def __init__(self, n):
        self.a = n
        self.b = n + 1
        self.c = n + 2

class Many:
    def __init__(self, n):
        for i, name in enumerate("abcdefghijklmnopqrstuvwxyz"):
            setattr(self, name, n + i)

class Slotted:
    __slots__ = ("s1", "s2")

class SlottedWithDict(Slotted):
    def __init__(self):
        self.s1 = "slot 1"
        self.x = "x"
        self.s2 = "slot 2"
        self.y = "y"

class SlotsDictAndWeakref:
    __slots__ = ("s", "__dict__", "__weakref__")

def show(label, o):
    d = o.__dict__
    print(label, list(d.items()), vars(o) is d, o.__dict__ is d)
    return d

print("--- order and values")
show("none", Plain())
show("three", Three(1))
show("many", Many(100))

print("--- the dict and the object are one")
o = Three(1)
d = show("before", o)
o.d = 4
d["e"] = 5
del o.a
del d["b"]
print(list(d.items()), o.c, o.d, o.e, hasattr(o, "a"), hasattr(o, "b"))
try:
    o.a
except AttributeError as e:
    print(e)
d.clear()
print(o.__dict__, hasattr(o, "c"))
o.z = 1
print(d)

print("--- attributes deleted and set again before")
o = Three(1)
del o.b
o.b = "again"
del o.a
show("deleted", o)
o = Many(0)
for name in "acegikmoqsuwy":
    delattr(o, name)
show("every other one", o)
o.a = "new"
print(list(o.__dict__)[-2:], o.a, o.z)

print("--- what __slots__ names stays out of it")
o = SlottedWithDict()
d = show("slots", o)
print(o.s1, o.s2, o.x, o.y)
o.s1 = "changed"
d["s2"] = "in the dict"
print(o.s1, o.s2, d)
del o.s2
try:
    o.s2
except AttributeError as e:
    print(type(e).__name__)
o = SlotsDictAndWeakref()
o.s = 1
o.t = 2
r = weakref.ref(o)
show("slots, __dict__, __weakref__", o)
print(o.s, o.t, r() is o)

print("--- another class")
class Other:
    def __init__(self, n):
        self.q = n
    def who(self):
        return "Other", sorted(vars(self))
class OtherThree(Three):
    def who(self):
        return "OtherThree", sorted(vars(self))
o = Three(1)
o.__class__ = OtherThree
print(o.who(), o.a)
o = Three(1)
o.__dict__
o.__class__ = OtherThree
print(o.who(), o.a)
o = Three(1)
o.__class__ = Other
show("became Other", o)
print(o.who())
o.q = 9
print(o.who(), o.q)

print("--- the same code sees objects of both kinds")
def total(o):
    return o.a + o.b + o.c
def bump(o):
    o.a += 1
    o.extra = o.a
objects = [Three(i) for i in range(40)]
for i, o in enumerate(objects):
    if i % 3 == 0:
        o.__dict__
print([total(o) for o in objects])
for o in objects:
    bump(o)
for i, o in enumerate(objects):
    if i % 3 == 1:
        o.__dict__
print([total(o) for o in objects], [o.extra for o in objects][:5])
for o in objects:
    bump(o)
print(sum(total(o) for o in objects), {tuple(o.__dict__) for o in objects})
def missing(o):
    try:
        return o.nothing
    except AttributeError:
        return None
print([missing(o) for o in objects[:4]])
objects[0].__dict__["nothing"] = "there"
objects[1].nothing = "there too"
print([missing(o) for o in objects[:4]])

print("--- methods and class attributes behind the dict")
class WithClassAttribute:
    kind = "class"
    def method(self):
        return "method"
o = WithClassAttribute()
o.own = 1
print(o.kind, o.method(), o.__dict__)
o.__dict__["kind"] = "instance"
o.__dict__["method"] = lambda: "instance"
print(o.kind, o.method())
del o.__dict__["kind"], o.__dict__["method"]
print(o.kind, o.method())

print("--- a new dict, and none")
o = Three(1)
o.__dict__ = {"only": 1}
print(vars(o), hasattr(o, "a"), o.only)
o = Three(1)
old = o.__dict__
o.__dict__ = new = {"a": "new"}
old["a"] = "old"
print(o.a, o.__dict__ is new)
try:
    o.__dict__ = 1
except TypeError as e:
    print(e)
class D(dict):
    pass
o.__dict__ = D(a="of a class derived from dict")
print(type(o.__dict__).__name__, o.a)

print("--- names that are no identifiers")
o = Three(1)
setattr(o, "0", "zero")
setattr(o, "", "empty")
setattr(o, "a b", "space")
setattr(o, "é\U0001f600", "not ASCII")
print(list(o.__dict__.items()), getattr(o, "0"), getattr(o, ""))
class Name(str):
    pass
o = Three(1)
setattr(o, Name("named"), 1)
print([(type(k).__name__, k) for k in o.__dict__], o.named)
o = Plain()
o.__dict__[1] = "an int"
o.__dict__[("t",)] = "a tuple"
o.x = 1
print(o.__dict__, sorted(map(str, vars(o))))

print("--- update, copies, pickles")
class Kw:
    def __init__(self, a, **kw):
        self.a = a
        self.__dict__.update(kw)
        self.z = "last"
o = Kw(1, b=2, c=3)
print(vars(o), o.b)
for o in (Three(1), Many(5), Kw(1, b=2)):
    for how in (copy.copy, copy.deepcopy, lambda x: pickle.loads(pickle.dumps(x))):
        p = how(o)
        print(type(p).__name__, vars(p) == vars(o), vars(p) is not vars(o), list(vars(p)) == list(vars(o)))

print("--- the values live on, the object can go")
class Value:
    pass
o = Many(0)
o.a = v = Value()
r = weakref.ref(v)
del v
d = o.__dict__
gc.collect()
print(r() is o.a, r() is d["a"])
ro = weakref.ref(o)
del o
gc.collect()
print(ro() is None, r() is d["a"])
del d
gc.collect()
print(r() is None)

print("--- many objects")
objects = [Many(i) for i in range(3000)]
print(sum(len(o.__dict__) for o in objects), sum(o.z for o in objects), len({tuple(o.__dict__) for o in objects}))
gc.collect()
print(sum(o.a + o.m for o in objects))
