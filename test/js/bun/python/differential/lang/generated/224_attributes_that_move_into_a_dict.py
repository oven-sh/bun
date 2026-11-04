# obj.__dict__ of objects in every state an object can be in when a program first asks for it, and what the object and the dict
# have to do with each other from then on.
try: import copy, gc, pickle, weakref
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import copy, gc, pickle, weakref')

try:
    class Plain:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Plain:')

try:
    class Three:
        def __init__(self, n):
            self.a = n
            self.b = n + 1
            self.c = n + 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Three:')

try:
    class Many:
        def __init__(self, n):
            for i, name in enumerate("abcdefghijklmnopqrstuvwxyz"):
                setattr(self, name, n + i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Many:')

try:
    class Slotted:
        __slots__ = ("s1", "s2")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Slotted:')

try:
    class SlottedWithDict(Slotted):
        def __init__(self):
            self.s1 = "slot 1"
            self.x = "x"
            self.s2 = "slot 2"
            self.y = "y"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SlottedWithDict(Slotted):')

try:
    class SlotsDictAndWeakref:
        __slots__ = ("s", "__dict__", "__weakref__")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SlotsDictAndWeakref:')

try:
    def show(label, o):
        d = o.__dict__
        print(label, list(d.items()), vars(o) is d, o.__dict__ is d)
        return d
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(label, o):')

try: print("--- order and values")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- order and values"')
try: show("none", Plain())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("none", Plain())')
try: show("three", Three(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("three", Three(1))')
try: show("many", Many(100))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("many", Many(100))')

try: print("--- the dict and the object are one")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- the dict and the object are one"')
try: o = Three(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Three(1)')
try: d = show("before", o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = show("before", o)')
try: o.d = 4
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.d = 4')
try: d["e"] = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d["e"] = 5')
try: del o.a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del o.a')
try: del d["b"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del d["b"]')
try: print('list(d.items()) =>', list(d.items()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(d.items())')
try: print('o.c =>', o.c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.c')
try: print('o.d =>', o.d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.d')
try: print('o.e =>', o.e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.e')
try: print('hasattr(o, "a") =>', hasattr(o, "a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(o, "a")')
try: print('hasattr(o, "b") =>', hasattr(o, "b"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(o, "b")')
try:
    try:
        o.a
    except AttributeError as e:
        print(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: d.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.clear()')
try: print('o.__dict__ =>', o.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dict__')
try: print('hasattr(o, "c") =>', hasattr(o, "c"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(o, "c")')
try: o.z = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.z = 1')
try: print(d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d')

try: print("--- attributes deleted and set again before")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- attributes deleted and set again before"')
try: o = Three(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Three(1)')
try: del o.b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del o.b')
try: o.b = "again"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.b = "again"')
try: del o.a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del o.a')
try: show("deleted", o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("deleted", o)')
try: o = Many(0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Many(0)')
try:
    for name in "acegikmoqsuwy":
        try: delattr(o, name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: delattr(o, name)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name in "acegikmoqsuwy":')
try: show("every other one", o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("every other one", o)')
try: o.a = "new"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.a = "new"')
try: print('list(o.__dict__)[-2:] =>', list(o.__dict__)[-2:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(o.__dict__)[-2:]')
try: print('o.a =>', o.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.a')
try: print('o.z =>', o.z)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.z')

try: print("--- what __slots__ names stays out of it")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- what __slots__ names stays out of it"')
try: o = SlottedWithDict()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = SlottedWithDict()')
try: d = show("slots", o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = show("slots", o)')
try: print('o.s1 =>', o.s1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.s1')
try: print('o.s2 =>', o.s2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.s2')
try: print('o.x =>', o.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.x')
try: print('o.y =>', o.y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.y')
try: o.s1 = "changed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.s1 = "changed"')
try: d["s2"] = "in the dict"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d["s2"] = "in the dict"')
try: print('o.s1 =>', o.s1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.s1')
try: print('o.s2 =>', o.s2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.s2')
try: print('d =>', d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d')
try: del o.s2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del o.s2')
try:
    try:
        o.s2
    except AttributeError as e:
        print(type(e).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: o = SlotsDictAndWeakref()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = SlotsDictAndWeakref()')
try: o.s = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.s = 1')
try: o.t = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.t = 2')
try: r = weakref.ref(o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = weakref.ref(o)')
try: show("slots, __dict__, __weakref__", o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("slots, __dict__, __weakref__", o)')
try: print('o.s =>', o.s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.s')
try: print('o.t =>', o.t)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.t')
try: print('r() is o =>', r() is o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r() is o')

try: print("--- another class")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- another class"')
try:
    class Other:
        def __init__(self, n):
            self.q = n
        def who(self):
            return "Other", sorted(vars(self))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Other:')
try:
    class OtherThree(Three):
        def who(self):
            return "OtherThree", sorted(vars(self))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class OtherThree(Three):')
try: o = Three(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Three(1)')
try: o.__class__ = OtherThree
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__class__ = OtherThree')
try: print('o.who() =>', o.who())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.who()')
try: print('o.a =>', o.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.a')
try: o = Three(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Three(1)')
try: o.__dict__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dict__')
try: o.__class__ = OtherThree
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__class__ = OtherThree')
try: print('o.who() =>', o.who())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.who()')
try: print('o.a =>', o.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.a')
try: o = Three(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Three(1)')
try: o.__class__ = Other
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__class__ = Other')
try: show("became Other", o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("became Other", o)')
try: print(o.who())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.who()')
try: o.q = 9
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.q = 9')
try: print('o.who() =>', o.who())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.who()')
try: print('o.q =>', o.q)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.q')

try: print("--- the same code sees objects of both kinds")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- the same code sees objects of both kinds"')
try:
    def total(o):
        return o.a + o.b + o.c
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def total(o):')
try:
    def bump(o):
        o.a += 1
        o.extra = o.a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bump(o):')
try: objects = [Three(i) for i in range(40)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: objects = [Three(i) for i in range(40)]')
try:
    for i, o in enumerate(objects):
        if i % 3 == 0:
            try: o.__dict__
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dict__')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i, o in enumerate(objects):')
try: print([total(o) for o in objects])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [total(o) for o in objects]')
try:
    for o in objects:
        try: bump(o)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bump(o)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for o in objects:')
try:
    for i, o in enumerate(objects):
        if i % 3 == 1:
            try: o.__dict__
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dict__')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i, o in enumerate(objects):')
try: print('[total(o) for o in objects] =>', [total(o) for o in objects])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [total(o) for o in objects]')
try: print('[o.extra for o in objects][:5] =>', [o.extra for o in objects][:5])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [o.extra for o in objects][:5]')
try:
    for o in objects:
        try: bump(o)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bump(o)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for o in objects:')
try: print('sum(total(o) for o in objects) =>', sum(total(o) for o in objects))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(total(o) for o in objects)')
try: print('{tuple(o.__dict__) for o in objects} =>', {tuple(o.__dict__) for o in objects})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {tuple(o.__dict__) for o in objects}')
try:
    def missing(o):
        try:
            return o.nothing
        except AttributeError:
            return None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def missing(o):')
try: print([missing(o) for o in objects[:4]])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [missing(o) for o in objects[:4]]')
try: objects[0].__dict__["nothing"] = "there"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: objects[0].__dict__["nothing"] = "there"')
try: objects[1].nothing = "there too"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: objects[1].nothing = "there too"')
try: print([missing(o) for o in objects[:4]])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [missing(o) for o in objects[:4]]')

try: print("--- methods and class attributes behind the dict")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- methods and class attributes behind the dict"')
try:
    class WithClassAttribute:
        kind = "class"
        def method(self):
            return "method"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithClassAttribute:')
try: o = WithClassAttribute()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = WithClassAttribute()')
try: o.own = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.own = 1')
try: print('o.kind =>', o.kind)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.kind')
try: print('o.method() =>', o.method())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.method()')
try: print('o.__dict__ =>', o.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dict__')
try: o.__dict__["kind"] = "instance"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dict__["kind"] = "instance"')
try: o.__dict__["method"] = lambda: "instance"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dict__["method"] = lambda: "instance"')
try: print('o.kind =>', o.kind)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.kind')
try: print('o.method() =>', o.method())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.method()')
try: del o.__dict__["kind"], o.__dict__["method"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del o.__dict__["kind"], o.__dict__["method"]')
try: print('o.kind =>', o.kind)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.kind')
try: print('o.method() =>', o.method())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.method()')

try: print("--- a new dict, and none")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- a new dict, and none"')
try: o = Three(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Three(1)')
try: o.__dict__ = {"only": 1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dict__ = {"only": 1}')
try: print('vars(o) =>', vars(o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vars(o)')
try: print('hasattr(o, "a") =>', hasattr(o, "a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(o, "a")')
try: print('o.only =>', o.only)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.only')
try: o = Three(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Three(1)')
try: old = o.__dict__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: old = o.__dict__')
try: o.__dict__ = new = {"a": "new"}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dict__ = new = {"a": "new"}')
try: old["a"] = "old"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: old["a"] = "old"')
try: print('o.a =>', o.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.a')
try: print('o.__dict__ is new =>', o.__dict__ is new)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dict__ is new')
try:
    try:
        o.__dict__ = 1
    except TypeError as e:
        print(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    class D(dict):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class D(dict):')
try: o.__dict__ = D(a="of a class derived from dict")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dict__ = D(a="of a class derived from dict")')
try: print('type(o.__dict__).__name__ =>', type(o.__dict__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(o.__dict__).__name__')
try: print('o.a =>', o.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.a')

try: print("--- names that are no identifiers")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- names that are no identifiers"')
try: o = Three(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Three(1)')
try: setattr(o, "0", "zero")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setattr(o, "0", "zero")')
try: setattr(o, "", "empty")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setattr(o, "", "empty")')
try: setattr(o, "a b", "space")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setattr(o, "a b", "space")')
try: setattr(o, "é\U0001f600", "not ASCII")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setattr(o, "é\\U0001f600", "not ASCII")')
try: print('list(o.__dict__.items()) =>', list(o.__dict__.items()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(o.__dict__.items())')
try: print('getattr(o, "0") =>', getattr(o, "0"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: getattr(o, "0")')
try: print('getattr(o, "") =>', getattr(o, ""))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: getattr(o, "")')
try:
    class Name(str):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Name(str):')
try: o = Three(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Three(1)')
try: setattr(o, Name("named"), 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setattr(o, Name("named"), 1)')
try: print('[(type(k).__name__, k) for k in o.__dict__] =>', [(type(k).__name__, k) for k in o.__dict__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [(type(k).__name__, k) for k in o.__dict__]')
try: print('o.named =>', o.named)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.named')
try: o = Plain()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Plain()')
try: o.__dict__[1] = "an int"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dict__[1] = "an int"')
try: o.__dict__[("t",)] = "a tuple"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dict__[("t",)] = "a tuple"')
try: o.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.x = 1')
try: print('o.__dict__ =>', o.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dict__')
try: print('sorted(map(str, vars(o))) =>', sorted(map(str, vars(o))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(map(str, vars(o)))')

try: print("--- update, copies, pickles")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- update, copies, pickles"')
try:
    class Kw:
        def __init__(self, a, **kw):
            self.a = a
            self.__dict__.update(kw)
            self.z = "last"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Kw:')
try: o = Kw(1, b=2, c=3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Kw(1, b=2, c=3)')
try: print('vars(o) =>', vars(o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vars(o)')
try: print('o.b =>', o.b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.b')
try:
    for o in (Three(1), Many(5), Kw(1, b=2)):
        for how in (copy.copy, copy.deepcopy, lambda x: pickle.loads(pickle.dumps(x))):
            try: p = how(o)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p = how(o)')
            try: print('type(p).__name__ [' + 'o=' + (repr(o) if type(o) in (str, int, float, bytes, bool, type(None)) or (type(o) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in o)) else o.__name__ if type(o) is type else type(o).__name__) + ", " + 'how=' + (repr(how) if type(how) in (str, int, float, bytes, bool, type(None)) or (type(how) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in how)) else how.__name__ if type(how) is type else type(how).__name__) + '] =>', type(p).__name__)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(p).__name__')
            try: print('vars(p) == vars(o) [' + 'o=' + (repr(o) if type(o) in (str, int, float, bytes, bool, type(None)) or (type(o) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in o)) else o.__name__ if type(o) is type else type(o).__name__) + ", " + 'how=' + (repr(how) if type(how) in (str, int, float, bytes, bool, type(None)) or (type(how) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in how)) else how.__name__ if type(how) is type else type(how).__name__) + '] =>', vars(p) == vars(o))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vars(p) == vars(o)')
            try: print('vars(p) is not vars(o) [' + 'o=' + (repr(o) if type(o) in (str, int, float, bytes, bool, type(None)) or (type(o) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in o)) else o.__name__ if type(o) is type else type(o).__name__) + ", " + 'how=' + (repr(how) if type(how) in (str, int, float, bytes, bool, type(None)) or (type(how) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in how)) else how.__name__ if type(how) is type else type(how).__name__) + '] =>', vars(p) is not vars(o))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vars(p) is not vars(o)')
            try: print('list(vars(p)) == list(vars(o)) [' + 'o=' + (repr(o) if type(o) in (str, int, float, bytes, bool, type(None)) or (type(o) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in o)) else o.__name__ if type(o) is type else type(o).__name__) + ", " + 'how=' + (repr(how) if type(how) in (str, int, float, bytes, bool, type(None)) or (type(how) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in how)) else how.__name__ if type(how) is type else type(how).__name__) + '] =>', list(vars(p)) == list(vars(o)))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(vars(p)) == list(vars(o))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for o in (Three(1), Many(5), Kw(1, b=2)):')

try: print("--- the values live on, the object can go")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- the values live on, the object can go"')
try:
    class Value:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Value:')
try: o = Many(0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Many(0)')
try: o.a = v = Value()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.a = v = Value()')
try: r = weakref.ref(v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = weakref.ref(v)')
try: del v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del v')
try: d = o.__dict__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = o.__dict__')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print('r() is o.a =>', r() is o.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r() is o.a')
try: print('r() is d["a"] =>', r() is d["a"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r() is d["a"]')
try: ro = weakref.ref(o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ro = weakref.ref(o)')
try: del o
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del o')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print('ro() is None =>', ro() is None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ro() is None')
try: print('r() is d["a"] =>', r() is d["a"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r() is d["a"]')
try: del d
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del d')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print(r() is None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r() is None')

try: print("--- many objects")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- many objects"')
try: objects = [Many(i) for i in range(3000)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: objects = [Many(i) for i in range(3000)]')
try: print('sum(len(o.__dict__) for o in objects) =>', sum(len(o.__dict__) for o in objects))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(len(o.__dict__) for o in objects)')
try: print('sum(o.z for o in objects) =>', sum(o.z for o in objects))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(o.z for o in objects)')
try: print('len({tuple(o.__dict__) for o in objects}) =>', len({tuple(o.__dict__) for o in objects}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len({tuple(o.__dict__) for o in objects})')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print(sum(o.a + o.m for o in objects))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(o.a + o.m for o in objects)')
