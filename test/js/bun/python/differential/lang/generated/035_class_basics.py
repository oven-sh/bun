try:
    def t(f):
        try:
            print(repr(f()))
        except Exception as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
    class A: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A: pass')
try: a = A()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = A()')
try: print('A.__name__ =>', A.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__name__')
try: print('A.__qualname__ =>', A.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__qualname__')
try: print('A.__module__ =>', A.__module__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__module__')
try: print('A.__bases__ =>', A.__bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__bases__')
try: print('A.__mro__ =>', A.__mro__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__mro__')
try: print('type(A) =>', type(A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(A)')
try: print('type(a) is A =>', type(a) is A)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(a) is A')
try: print('a.__class__ is A =>', a.__class__ is A)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__class__ is A')
try: print('isinstance(a, A) =>', isinstance(a, A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(a, A)')
try: print('isinstance(a, object) =>', isinstance(a, object))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(a, object)')
try: print('issubclass(A, object) =>', issubclass(A, object))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: issubclass(A, object)')
try: print('A.__doc__ =>', A.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__doc__')
try: print('a.__dict__ =>', a.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__dict__')
try: print('repr(A) =>', repr(A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(A)')
try: print('str(A) =>', str(A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: str(A)')
try: print('A.__base__ =>', A.__base__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__base__')
try: print('callable(A) =>', callable(A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: callable(A)')
try: print('bool(a) =>', bool(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(a)')
try: print('a == a =>', a == a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a == a')
try: print('a != a =>', a != a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a != a')
try: print('a == A() =>', a == A())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a == A()')
try: print('hash(a) == hash(a) =>', hash(a) == hash(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(a) == hash(a)')
try: print('A.__dict__["__module__"] =>', A.__dict__["__module__"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__dict__["__module__"]')
try: print('sorted(A.__dict__) =>', sorted(A.__dict__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(A.__dict__)')
try: a.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.x = 1')
try: a.y = [2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.y = [2]')
try: print('a.x =>', a.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.x')
try: print('a.y =>', a.y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.y')
try: print('a.__dict__ =>', a.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__dict__')
try: print('vars(a) =>', vars(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vars(a)')
try: print('hasattr(a, "x") =>', hasattr(a, "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(a, "x")')
try: print('hasattr(a, "z") =>', hasattr(a, "z"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(a, "z")')
try: print('getattr(a, "x") =>', getattr(a, "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: getattr(a, "x")')
try: print('getattr(a, "z", "dflt") =>', getattr(a, "z", "dflt"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: getattr(a, "z", "dflt")')
try: del a.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del a.x')
try: print('a.__dict__ =>', a.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__dict__')
try: print('hasattr(a, "x") =>', hasattr(a, "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(a, "x")')
try: setattr(a, "w", 3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setattr(a, "w", 3)')
try: print(a.w)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.w')
try: delattr(a, "w")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: delattr(a, "w")')
try: print(a.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__dict__')
try: print('a.nope =>', end=" "); t(lambda: a.nope)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a.nope)')
try: print('A.nope =>', end=" "); t(lambda: A.nope)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A.nope)')
try:
    def d1(): del a.nope
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d1(): del a.nope')
try:
    def d2(): del A.nope
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def d2(): del A.nope')
try: print('d1() =>', end=" "); t(d1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(d1)')
try: print('d2() =>', end=" "); t(d2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(d2)')
try: print('getattr(a, "nope") =>', end=" "); t(lambda: getattr(a, "nope"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: getattr(a, "nope"))')
try: print('getattr(a, 1) =>', end=" "); t(lambda: getattr(a, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: getattr(a, 1))')
try: print('setattr(a, 1, 2) =>', end=" "); t(lambda: setattr(a, 1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: setattr(a, 1, 2))')
try: print('delattr(a, "nope") =>', end=" "); t(lambda: delattr(a, "nope"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: delattr(a, "nope"))')
try: print('hasattr(a, 1) =>', end=" "); t(lambda: hasattr(a, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: hasattr(a, 1))')
try: print('A(1) =>', end=" "); t(lambda: A(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A(1))')
try: print('A(x=1) =>', end=" "); t(lambda: A(x=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: A(x=1))')
try: print('a() =>', end=" "); t(lambda: a())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a())')
try: print('a + 1 =>', end=" "); t(lambda: a + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a + 1)')
try: print('a < a =>', end=" "); t(lambda: a < a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a < a)')
try: print('len(a) =>', end=" "); t(lambda: len(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: len(a))')
try: print('a[0] =>', end=" "); t(lambda: a[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a[0])')
try: print('iter(a) =>', end=" "); t(lambda: iter(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: iter(a))')
try: print('int(a) =>', end=" "); t(lambda: int(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: int(a))')
try: print('-a =>', end=" "); t(lambda: -a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: -a)')
try: print('1 in a =>', end=" "); t(lambda: 1 in a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: 1 in a)')
try:
    def si(): a[0] = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def si(): a[0] = 1')
try:
    def di(): del a[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def di(): del a[0]')
try: print('si() =>', end=" "); t(si)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(si)')
try: print('di() =>', end=" "); t(di)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(di)')
try:
    class P:
        "Doc of P"
        count = 0
        names = []
        def __init__(self, x, y=0):
            self.x = x; self.y = y; P.count += 1
        def dist(self): return (self.x ** 2 + self.y ** 2) ** 0.5
        def move(self, dx, dy=0):
            self.x += dx; self.y += dy; return self
        def __repr__(self): return "P(%r, %r)" % (self.x, self.y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class P:')
try: p = P(3, 4)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p = P(3, 4)')
try: q = P(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: q = P(1)')
try: print('p =>', p)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p')
try: print('q =>', q)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: q')
try: print('p.dist() =>', p.dist())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.dist()')
try: print('p.move(1, 1) =>', p.move(1, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.move(1, 1)')
try: print('p.move(1).move(1) =>', p.move(1).move(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.move(1).move(1)')
try: print('P.count =>', P.count)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.count')
try: print('p.count =>', p.count)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.count')
try: print('P.__doc__ =>', P.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.__doc__')
try: print('p.__doc__ =>', p.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__doc__')
try: print('p.__dict__ =>', p.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__dict__')
try: print('P.dist(p) =>', P.dist(p))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.dist(p)')
try: print('P.__init__.__name__ =>', P.__init__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.__init__.__name__')
try: print('[p, q] =>', [p, q])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [p, q]')
try: print('(p,) =>', (p,))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (p,)')
try: print('{"k": p} =>', {"k": p})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {"k": p}')
try: print('str(p) =>', str(p))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: str(p)')
try: print('"%s %r" % (p, p) =>', "%s %r" % (p, p))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "%s %r" % (p, p)')
try: print('f"{p} {p!r}" =>', f"{p} {p!r}")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f"{p} {p!r}"')
try: print('P() =>', end=" "); t(lambda: P())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: P())')
try: print('P(1, 2, 3) =>', end=" "); t(lambda: P(1, 2, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: P(1, 2, 3))')
try: print('P(z=1) =>', end=" "); t(lambda: P(z=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: P(z=1))')
try: print('p.dist(1) =>', end=" "); t(lambda: p.dist(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: p.dist(1))')
try: print('P.dist() =>', end=" "); t(lambda: P.dist())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: P.dist())')
try: print('P.move(p) =>', end=" "); t(lambda: P.move(p))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: P.move(p))')
# Class attributes against instance attributes.
try: p.count = 100
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.count = 100')
try: print('p.count =>', p.count)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.count')
try: print('q.count =>', q.count)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: q.count')
try: print('P.count =>', P.count)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.count')
try: del p.count
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del p.count')
try: print(p.count)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.count')
try: P.count = 7
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.count = 7')
try: print('p.count =>', p.count)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.count')
try: print('q.count =>', q.count)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: q.count')
try: p.names.append("shared")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.names.append("shared")')
try: print('q.names =>', q.names)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: q.names')
try: print('P.names =>', P.names)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.names')
try: p.names = ["own"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.names = ["own"]')
try: print('p.names =>', p.names)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.names')
try: print('q.names =>', q.names)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: q.names')
try: P.new_attr = "added"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.new_attr = "added"')
try: print('p.new_attr =>', p.new_attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.new_attr')
try: print('q.new_attr =>', q.new_attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: q.new_attr')
try: del P.new_attr
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del P.new_attr')
try: print('p.new_attr =>', end=" "); t(lambda: p.new_attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: p.new_attr)')
try: P.shout = lambda self: "x=%d" % self.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.shout = lambda self: "x=%d" % self.x')
try: print('p.shout() =>', p.shout())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.shout()')
try: print('q.shout() =>', q.shout())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: q.shout()')
try: p.dist = lambda: "instance attribute wins"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.dist = lambda: "instance attribute wins"')
try: print('p.dist() =>', p.dist())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.dist()')
try: print('q.dist() =>', q.dist())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: q.dist()')
try: del p.dist
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del p.dist')
try: print(p.dist())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.dist()')
try:
    def external(self, k): return self.x * k
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def external(self, k): return self.x * k')
try: P.times = external
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.times = external')
try: print('p.times(2) =>', p.times(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.times(2)')
try: print('P.times(p, 3) =>', P.times(p, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.times(p, 3)')
try: print('p.times.__func__ is external =>', p.times.__func__ is external)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.times.__func__ is external')
try: print('p.times.__self__ is p =>', p.times.__self__ is p)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.times.__self__ is p')
try: p.func = external
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.func = external')
try: print('p.func(2) =>', end=" "); t(lambda: p.func(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: p.func(2))')
try: print(p.func(q, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.func(q, 2)')
# The body is executed like a function body, in order.
try:
    class B:
        print("in body", end="; ")
        a = 1; b = a + 1
        for i in range(3): pass
        if b > 1: c = "yes"
        else: c = "no"
        def m(self): return self.b
        n = m
        l = [1, 2, 3]; s = sum(l)
        try: e = 1 / 0
        except ZeroDivisionError: e = "caught"
        del a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class B:')
try: print('B.b =>', B.b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: B.b')
try: print('B.i =>', B.i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: B.i')
try: print('B.c =>', B.c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: B.c')
try: print('B().n() =>', B().n())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: B().n()')
try: print('B.s =>', B.s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: B.s')
try: print('B.e =>', B.e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: B.e')
try: print('hasattr(B, "a") =>', hasattr(B, "a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(B, "a")')
try: print('B.m is B.n =>', B.m is B.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: B.m is B.n')
try: print('[k for k in B.__dict__ if not k.startswith("__")] =>', [k for k in B.__dict__ if not k.startswith("__")])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [k for k in B.__dict__ if not k.startswith("__")]')
try:
    class Empty: ...
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Empty: ...')
try:
    class WithPass: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithPass: pass')
try:
    class WithDoc: "only doc"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithDoc: "only doc"')
try:
    class OneLine: x = 1; y = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class OneLine: x = 1; y = 2')
try: print('Empty.__doc__ =>', Empty.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Empty.__doc__')
try: print('WithDoc.__doc__ =>', WithDoc.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: WithDoc.__doc__')
try: print('OneLine.x + OneLine.y =>', OneLine.x + OneLine.y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: OneLine.x + OneLine.y')
try: print('Empty().__dict__ =>', Empty().__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Empty().__dict__')
try:
    class Parens(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Parens(): pass')
try: print(Parens.__bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Parens.__bases__')
# Classes are values.
try:
    def make(n):
        class Local:
            v = n
            def get(self): return n
        return Local
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def make(n):')
try: L1 = make(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: L1 = make(1)')
try: L2 = make(2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: L2 = make(2)')
try: print('L1.v =>', L1.v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: L1.v')
try: print('L2.v =>', L2.v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: L2.v')
try: print('L1().get() =>', L1().get())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: L1().get()')
try: print('L2().get() =>', L2().get())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: L2().get()')
try: print('L1 is L2 =>', L1 is L2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: L1 is L2')
try: print('L1.__name__ =>', L1.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: L1.__name__')
try: print('L1.__qualname__ =>', L1.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: L1.__qualname__')
try: print('L1 == L1 =>', L1 == L1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: L1 == L1')
try: print('L1 != L2 =>', L1 != L2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: L1 != L2')
try: print('hash(L1) == hash(L1) =>', hash(L1) == hash(L1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(L1) == hash(L1)')
try: print('{L1: 1}[L1] =>', {L1: 1}[L1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {L1: 1}[L1]')
try: classes = [A, P, int, str]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: classes = [A, P, int, str]')
try: print('[c.__name__ for c in classes] =>', [c.__name__ for c in classes])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in classes]')
try: print('[c for c in classes if issubclass(c, (int, A))] =>', [c for c in classes if issubclass(c, (int, A))])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c for c in classes if issubclass(c, (int, A))]')
try: Alias = P
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Alias = P')
try: print('Alias(0).x =>', Alias(0).x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Alias(0).x')
try: print('Alias is P =>', Alias is P)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Alias is P')
try: print('Alias.__name__ =>', Alias.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Alias.__name__')
try:
    class Outer:
        class Inner:
            v = "inner"
            class Deep: pass
        def make(self): return self.Inner()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Outer:')
try: print('Outer.Inner.v =>', Outer.Inner.v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Outer.Inner.v')
try: print('Outer().make().v =>', Outer().make().v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Outer().make().v')
try: print('Outer.Inner.__qualname__ =>', Outer.Inner.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Outer.Inner.__qualname__')
try: print('Outer.Inner.Deep.__qualname__ =>', Outer.Inner.Deep.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Outer.Inner.Deep.__qualname__')
try: print('Outer.Inner.__name__ =>', Outer.Inner.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Outer.Inner.__name__')
try: print('repr(Outer.Inner.Deep) =>', repr(Outer.Inner.Deep))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(Outer.Inner.Deep)')
try: A.__name__ = "Renamed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__name__ = "Renamed"')
try: print('A.__name__ =>', A.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__name__')
try: print('repr(A) =>', repr(A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(A)')
try: print('A.__qualname__ =>', A.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__qualname__')
try: A.__qualname__ = "Q.Renamed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__qualname__ = "Q.Renamed"')
try: print(repr(A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(A)')
try: A.__module__ = "mod"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__module__ = "mod"')
try: print('repr(A) =>', repr(A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(A)')
try: print('A.__module__ =>', A.__module__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__module__')
try: A.__doc__ = "new"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__doc__ = "new"')
try: print(A.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__doc__')
try:
    def s1(): A.__name__ = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s1(): A.__name__ = 1')
try:
    def s2(): A.__qualname__ = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s2(): A.__qualname__ = 1')
try:
    def s3(): del A.__name__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s3(): del A.__name__')
try:
    def s4(): A.__dict__ = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s4(): A.__dict__ = {}')
try:
    def s5(): A.__dict__["x"] = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s5(): A.__dict__["x"] = 1')
try:
    def s6(): A.__mro__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s6(): A.__mro__ = ()')
try:
    def s7(): int.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s7(): int.x = 1')
try:
    def s8(): del int.real
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s8(): del int.real')
try:
    def s9(): int.__name__ = "x"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s9(): int.__name__ = "x"')
try:
    def s10(): object.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s10(): object.x = 1')
try:
    def s11(): A.__name__ = "a\0b"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s11(): A.__name__ = "a\\0b"')
try:
    def s12(): del A.__dict__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s12(): del A.__dict__')
try:
    def s13(): A.__bases__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s13(): A.__bases__ = ()')
try:
    def s14(): A.__base__ = int
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s14(): A.__base__ = int')
try:
    for s in (s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14): t(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for s in (s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14...')
try: print('type(A.__dict__).__name__ =>', type(A.__dict__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(A.__dict__).__name__')
try: print('"__dict__" in A.__dict__ =>', "__dict__" in A.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "__dict__" in A.__dict__')
try: print('"__weakref__" in A.__dict__ =>', "__weakref__" in A.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "__weakref__" in A.__dict__')
try: print('type(A.__dict__["__dict__"]).__name__ =>', type(A.__dict__["__dict__"]).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(A.__dict__["__dict__"]).__name__')
try: print('A.__dict__["__dict__"].__name__ =>', A.__dict__["__dict__"].__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__dict__["__dict__"].__name__')
try: print('A.__dict__["__dict__"].__objclass__ is A =>', A.__dict__["__dict__"].__objclass__ is A)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__dict__["__dict__"].__objclass__ is A')
try: a = A()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = A()')
try: a.__dict__ = {"k": "v"}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__dict__ = {"k": "v"}')
try: print('a.k =>', a.k)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.k')
try: print('a.__dict__ =>', a.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__dict__')
try: a.__dict__["j"] = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__dict__["j"] = 1')
try: print(a.j)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.j')
try: a.__dict__.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__dict__.clear()')
try: print(hasattr(a, "k"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(a, "k")')
try:
    def sd(): a.__dict__ = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sd(): a.__dict__ = 1')
try:
    def dd(): del a.__dict__; return a.__dict__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def dd(): del a.__dict__; return a.__dict__')
try: print('sd() =>', end=" "); t(sd)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(sd)')
try: print('dd() =>', end=" "); t(dd)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(dd)')
try:
    class X: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class X: pass')
try:
    class Y: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Y: pass')
try: x = X()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = X()')
try: x.v = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.v = 1')
try: x.__class__ = Y
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.__class__ = Y')
try: print('type(x).__name__ =>', type(x).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(x).__name__')
try: print('x.v =>', x.v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.v')
try: print('isinstance(x, Y) =>', isinstance(x, Y))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(x, Y)')
try: print('isinstance(x, X) =>', isinstance(x, X))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(x, X)')
try:
    def sc1(): x.__class__ = int
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sc1(): x.__class__ = int')
try:
    def sc2(): x.__class__ = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sc2(): x.__class__ = 1')
try:
    def sc3(): (1).__class__ = X
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sc3(): (1).__class__ = X')
try:
    def sc4(): del x.__class__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sc4(): del x.__class__')
try:
    def sc5(): [].__class__ = X
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sc5(): [].__class__ = X')
try: print('sc1() =>', end=" "); t(sc1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(sc1)')
try: print('sc2() =>', end=" "); t(sc2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(sc2)')
try: print('sc3() =>', end=" "); t(sc3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(sc3)')
try: print('sc4() =>', end=" "); t(sc4)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(sc4)')
try: print('sc5() =>', end=" "); t(sc5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(sc5)')
try: print('dir(X()) == dir(X) =>', dir(X()) == dir(X))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dir(X()) == dir(X)')
try: print('"v" in dir(x) =>', "v" in dir(x))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "v" in dir(x)')
try: print('[n for n in dir(P(0)) if not n.startswith("__")] =>', [n for n in dir(P(0)) if not n.startswith("__")])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [n for n in dir(P(0)) if not n.startswith("__")]')
try: print('sorted(set(dir(object))) == dir(object) =>', sorted(set(dir(object))) == dir(object))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(set(dir(object))) == dir(object)')
try: print('len(dir(object)) > 20 =>', len(dir(object)) > 20)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(dir(object)) > 20')
try: print('"__init__" in dir(A) =>', "__init__" in dir(A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "__init__" in dir(A)')
try: print(object(), object)[0:0] if False else print(repr(object)[:15], type(object()), object.__bases__, object.__mro__, object.__base__, object.__doc__ is not None, object.__name__, object().__class__, object.__module__, type(type), type.__bases__, type(object), isinstance(type, object), isinstance(object, type), issubclass(type, object))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(object(), object)[0:0] if False else print(repr(object)[:15], t...')
try: o = object()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = object()')
try:
    def so(): o.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def so(): o.x = 1')
try: print('so() =>', end=" "); t(so)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(so)')
try: print('o.__dict__ =>', end=" "); t(lambda: o.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: o.__dict__)')
try: print('object(1) =>', end=" "); t(lambda: object(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object(1))')
try: print('object(x=1) =>', end=" "); t(lambda: object(x=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object(x=1))')
try: print('o.x =>', end=" "); t(lambda: o.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: o.x)')
try: print('o == o =>', o == o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o == o')
try: print('o != o =>', o != o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o != o')
try: print('o == object() =>', o == object())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o == object()')
try: print('hash(o) == hash(o) =>', hash(o) == hash(o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(o) == hash(o)')
try: print('bool(o) =>', bool(o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(o)')
try: print('o.__eq__(o) =>', o.__eq__(o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__eq__(o)')
try: print('o.__eq__(1) =>', o.__eq__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__eq__(1)')
try: print('o.__ne__(o) =>', o.__ne__(o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__ne__(o)')
try: print('o.__ne__(1) =>', o.__ne__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__ne__(1)')
try: print('o.__lt__(o) =>', o.__lt__(o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__lt__(o)')
try: print('o.__init__() =>', o.__init__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__init__()')
try: print('o.__dir__() == dir(o) or sorted(o.__dir__()) == dir(o) =>', o.__dir__() == dir(o) or sorted(o.__dir__()) == dir(o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dir__() == dir(o) or sorted(o.__dir__()) == dir(o)')
try: print('o.__sizeof__() > 0 =>', o.__sizeof__() > 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__sizeof__() > 0')
try: print('o.__format__(""[:0])[:7] =>', o.__format__(""[:0])[:7])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__format__(""[:0])[:7]')
try: print('o.__reduce_ex__(2)[0].__name__ =>', o.__reduce_ex__(2)[0].__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__reduce_ex__(2)[0].__name__')
try: print('o.__init_subclass__() =>', o.__init_subclass__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__init_subclass__()')
try: print('o.__subclasshook__(int) =>', o.__subclasshook__(int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__subclasshook__(int)')
try: print('o.__getstate__() =>', o.__getstate__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__getstate__()')
