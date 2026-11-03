# __class__ in the body of a class that is inside a method: the body means the method's, its own methods mean the new class.
class Outer:
    def read(self):
        class X:
            x = __class__
            def f():
                return __class__
        return X.x, X.f()
    def assigned(self):
        class X:
            def f(self):
                return __class__
            __class__ = 413
        return X().f().__name__, X().__class__, X.__dict__['__class__']
    def nonlocal_(self):
        class X:
            nonlocal __class__
            __class__ = 42
            def f():
                return __class__
        return __class__, X.f().__name__, '__class__' in X.__dict__
    def with_super(self):
        class Base:
            def who(self): return 'Base'
        class X(Base):
            seen = __class__.__name__
            def who(self): return 'X over ' + super().who()
        return X.seen, X().who()
    def code(self):
        class X:
            x = __class__
            def f(): __class__
        return None
    def nested(self):
        class X:
            class Y:
                y = __class__
                def f(): return __class__
            def f(): return __class__
        return X.Y.y.__name__, X.Y.f().__name__, X.f().__name__
    def comprehension(self):
        class X:
            names = [__class__.__name__ for _ in range(1)]
            def f(): return __class__
        return X.names, X.f().__name__

o = Outer()
a, b = o.read()
print(a.__name__, b.__name__)
for method in (o.assigned, o.with_super, o.nested, o.comprehension):
    try:
        print(method.__name__, method())
    except NameError as e:
        print(method.__name__, type(e).__name__, e)
body = [c for c in Outer.code.__code__.co_consts if hasattr(c, 'co_name') and c.co_name == 'X'][0]
print(body.co_cellvars, body.co_freevars, Outer.code.__code__.co_freevars)
print(o.nonlocal_())

try:
    exec('class X:\n    __class__\n    def f():\n        __class__', {}, {})
except NameError as e:
    print(type(e).__name__, e)
namespace = {}
exec('class X:\n    global __class__\n    __class__ = 42\n    def f():\n        return __class__\nresult = X.f().__name__, "__class__" in X.__dict__', namespace)
print(namespace['result'], namespace['__class__'])
