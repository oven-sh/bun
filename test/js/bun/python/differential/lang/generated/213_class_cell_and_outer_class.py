# __class__ in the body of a class that is inside a method: the body means the method's, its own methods mean the new class.
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Outer:')

try: o = Outer()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Outer()')
try: a, b = o.read()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a, b = o.read()')
try: print('a.__name__ =>', a.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__name__')
try: print('b.__name__ =>', b.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b.__name__')
try:
    for method in (o.assigned, o.with_super, o.nested, o.comprehension):
        try:
            print('method.__name__ [' + 'method=' + (repr(method) if type(method) in (str, int, float, bytes, bool, type(None)) or (type(method) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in method)) else method.__name__ if type(method) is type else type(method).__name__) + '] =>', method.__name__)
            print('method() [' + 'method=' + (repr(method) if type(method) in (str, int, float, bytes, bool, type(None)) or (type(method) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in method)) else method.__name__ if type(method) is type else type(method).__name__) + '] =>', method())
        except NameError as e:
            print('method.__name__ [' + 'method=' + (repr(method) if type(method) in (str, int, float, bytes, bool, type(None)) or (type(method) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in method)) else method.__name__ if type(method) is type else type(method).__name__) + '] =>', method.__name__)
            print('type(e).__name__ [' + 'method=' + (repr(method) if type(method) in (str, int, float, bytes, bool, type(None)) or (type(method) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in method)) else method.__name__ if type(method) is type else type(method).__name__) + '] =>', type(e).__name__)
            print('e [' + 'method=' + (repr(method) if type(method) in (str, int, float, bytes, bool, type(None)) or (type(method) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in method)) else method.__name__ if type(method) is type else type(method).__name__) + '] =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for method in (o.assigned, o.with_super, o.nested, o.comprehension):')
try: body = [c for c in Outer.code.__code__.co_consts if hasattr(c, 'co_name') and c.co_name == 'X'][0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: body = [c for c in Outer.code.__code__.co_consts if hasattr(c, 'co_na...")
try: print('body.co_cellvars =>', body.co_cellvars)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: body.co_cellvars')
try: print('body.co_freevars =>', body.co_freevars)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: body.co_freevars')
try: print('Outer.code.__code__.co_freevars =>', Outer.code.__code__.co_freevars)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Outer.code.__code__.co_freevars')
try: print(o.nonlocal_())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.nonlocal_()')

try:
    try:
        exec('class X:\n    __class__\n    def f():\n        __class__', {}, {})
    except NameError as e:
        print('type(e).__name__ =>', type(e).__name__)
        print('e =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: namespace = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: namespace = {}')
try: exec('class X:\n    global __class__\n    __class__ = 42\n    def f():\n        return __class__\nresult = X.f().__name__, "__class__" in X.__dict__', namespace)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec('class X:\\n global __class__\\n __class__ = 42\\n def f():\\n retur...")
try: print("namespace['result'] =>", namespace['result'])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: namespace['result']")
try: print("namespace['__class__'] =>", namespace['__class__'])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: namespace['__class__']")
