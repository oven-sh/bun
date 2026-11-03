# name and obj of an AttributeError, whoever raises it, and of a NameError; what the suggestions are made from.
try: import sys, types
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, types')
try:
    def show(action):
        try:
            action()
            print("no error")
        except TypeError as e:
            print("TypeError |", e)
        except (AttributeError, NameError) as e:
            obj = getattr(e, "obj", "(none)")
            print(type(e).__name__, "|", e, "| name:", repr(e.name), "| obj:", type(obj).__name__ if obj is not None else None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(action):')

try:
    class Plain: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Plain: pass')
try:
    class WithGetattr:
        def __getattr__(self, name): raise AttributeError("custom message for " + name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithGetattr:')
try:
    class WithGetattrBare:
        def __getattr__(self, name): raise AttributeError
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithGetattrBare:')
try:
    class WithGetattrNamed:
        def __getattr__(self, name): raise AttributeError("named", name="other", obj=42)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithGetattrNamed:')
try:
    class WithGetattrOnlyName:
        def __getattr__(self, name): raise AttributeError("only name", name="other")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithGetattrOnlyName:')
try:
    class WithGetattribute:
        def __getattribute__(self, name): raise AttributeError("from getattribute")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithGetattribute:')
try:
    class WithProperty:
        @property
        def prop(self): raise AttributeError("inside the property")
        @property
        def deep(self): return Plain().missing
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithProperty:')
try:
    class WithSlots:
        __slots__ = ("a",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithSlots:')
try:
    class Meta(type):
        def __getattr__(cls, name): raise AttributeError("from the metaclass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Meta(type):')
try:
    class WithMeta(metaclass=Meta): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithMeta(metaclass=Meta): pass')
try:
    class Sub(AttributeError): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Sub(AttributeError): pass')
try:
    class RaisesSub:
        def __getattr__(self, name): raise Sub("a subclass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class RaisesSub:')

try: show(lambda: Plain().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: Plain().x)')
try: show(lambda: Plain.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: Plain.x)')
try: show(lambda: WithGetattr().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: WithGetattr().x)')
try: show(lambda: WithGetattrBare().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: WithGetattrBare().x)')
try: show(lambda: WithGetattrNamed().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: WithGetattrNamed().x)')
try: show(lambda: WithGetattrOnlyName().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: WithGetattrOnlyName().x)')
try: show(lambda: WithGetattribute().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: WithGetattribute().x)')
try: show(lambda: WithProperty().prop)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: WithProperty().prop)')
try: show(lambda: WithProperty().deep)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: WithProperty().deep)')
try: show(lambda: WithSlots().a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: WithSlots().a)')
try: show(lambda: WithSlots().b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: WithSlots().b)')
try: show(lambda: WithMeta.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: WithMeta.x)')
try: show(lambda: RaisesSub().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: RaisesSub().x)')
try: show(lambda: getattr(Plain(), "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: getattr(Plain(), "x"))')
try: show(lambda: getattr(WithGetattr(), "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: getattr(WithGetattr(), "x"))')
try: show(lambda: (1).x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: (1).x)')
try: show(lambda: "s".x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: "s".x)')
try: show(lambda: None.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: None.x)')
try: show(lambda: [].x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: [].x)')
try: show(lambda: sys.nothing_here)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: sys.nothing_here)')
try: show(lambda: types.ModuleType("m").x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: types.ModuleType("m").x)')
try: show(lambda: len.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: len.x)')
try: show(lambda: (lambda: 0).x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: (lambda: 0).x)')
try: show(lambda: super(Plain, Plain()).x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: super(Plain, Plain()).x)')
try: show(lambda: object().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: object().x)')
try: show(lambda: type.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: type.x)')
try: print('getattr(WithGetattr(), "x", "default") =>', getattr(WithGetattr(), "x", "default"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: getattr(WithGetattr(), "x", "default")')
try: print('hasattr(WithGetattr(), "x") =>', hasattr(WithGetattr(), "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(WithGetattr(), "x")')
try: print('hasattr(WithProperty(), "prop") =>', hasattr(WithProperty(), "prop"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(WithProperty(), "prop")')

# Storing and deleting
try:
    def store(o, n, v=1): setattr(o, n, v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def store(o, n, v=1): setattr(o, n, v)')
try: show(lambda: store(object(), "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: store(object(), "x"))')
try: show(lambda: store(WithSlots(), "b"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: store(WithSlots(), "b"))')
try: show(lambda: store(1, "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: store(1, "x"))')
try: show(lambda: store("s", "upper"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: store("s", "upper"))')
try: show(lambda: delattr(Plain(), "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: delattr(Plain(), "x"))')
try: show(lambda: delattr(WithSlots(), "a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: delattr(WithSlots(), "a"))')
try: show(lambda: delattr(WithSlots(), "b"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: delattr(WithSlots(), "b"))')
try: show(lambda: delattr(object(), "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: delattr(object(), "x"))')
try: show(lambda: store(len, "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: store(len, "x"))')
try: show(lambda: store(int, "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: store(int, "x"))')
try: show(lambda: delattr(int, "real"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: delattr(int, "real"))')

# Made by hand
try:
    for e in (AttributeError(), AttributeError("m"), AttributeError("m", name="n"), AttributeError("m", obj=1), AttributeError("m", name="n", obj=1), NameError("m", name="n"), NameError()):
        try: print('repr(e) [' + 'e=' + (repr(e) if type(e) in (str, int, float, bytes, bool, type(None)) or (type(e) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in e)) else e.__name__ if type(e) is type else type(e).__name__) + '] =>', repr(e))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(e)')
        try: print('e.args [' + 'e=' + (repr(e) if type(e) in (str, int, float, bytes, bool, type(None)) or (type(e) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in e)) else e.__name__ if type(e) is type else type(e).__name__) + '] =>', e.args)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.args')
        try: print('e.name [' + 'e=' + (repr(e) if type(e) in (str, int, float, bytes, bool, type(None)) or (type(e) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in e)) else e.__name__ if type(e) is type else type(e).__name__) + '] =>', e.name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.name')
        try: print('getattr(e, "obj", "-") [' + 'e=' + (repr(e) if type(e) in (str, int, float, bytes, bool, type(None)) or (type(e) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in e)) else e.__name__ if type(e) is type else type(e).__name__) + '] =>', getattr(e, "obj", "-"))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: getattr(e, "obj", "-")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for e in (AttributeError(), AttributeError("m"), AttributeError("m", ...')
try:
    for bad in (lambda: AttributeError("m", other=1), lambda: NameError("m", obj=1), lambda: AttributeError(name="n", obj=1, x=2)):
        try:
            bad()
        except TypeError as e:
            print("TypeError:", 'e [' + 'bad=' + (repr(bad) if type(bad) in (str, int, float, bytes, bool, type(None)) or (type(bad) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in bad)) else bad.__name__ if type(bad) is type else type(bad).__name__) + '] =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for bad in (lambda: AttributeError("m", other=1), lambda: NameError("...')
try: e = AttributeError("m", name="n", obj=[1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = AttributeError("m", name="n", obj=[1])')
try: import copy, pickle
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import copy, pickle')
try:
    for other in (copy.copy(e), pickle.loads(pickle.dumps(e))):
        try: print('repr(other) [' + 'other=' + (repr(other) if type(other) in (str, int, float, bytes, bool, type(None)) or (type(other) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in other)) else other.__name__ if type(other) is type else type(other).__name__) + '] =>', repr(other))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(other)')
        try: print('other.name [' + 'other=' + (repr(other) if type(other) in (str, int, float, bytes, bool, type(None)) or (type(other) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in other)) else other.__name__ if type(other) is type else type(other).__name__) + '] =>', other.name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: other.name')
        try: print('other.obj [' + 'other=' + (repr(other) if type(other) in (str, int, float, bytes, bool, type(None)) or (type(other) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in other)) else other.__name__ if type(other) is type else type(other).__name__) + '] =>', other.obj)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: other.obj')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for other in (copy.copy(e), pickle.loads(pickle.dumps(e))):')
try: e.name = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.name = 3')
try: e.obj = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.obj = None')
try: print('e.name =>', e.name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.name')
try: print('e.obj =>', e.obj)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.obj')
try: del e.name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del e.name')
try: print(e.name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.name')

# Names
try:
    def local_unbound():
        print(v)
        v = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def local_unbound():')
try:
    def free_unbound():
        def inner(): return w
        inner()
        w = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def free_unbound():')
try:
    def deleted():
        v = 1
        del v
        return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def deleted():')
try: show(lambda: undefined_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: undefined_name)')
try: show(local_unbound)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(local_unbound)')
try: show(free_unbound)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(free_unbound)')
try: show(deleted)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(deleted)')
try: show(lambda: eval("undefined_in_eval"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(lambda: eval("undefined_in_eval"))')
try:
    def del_global():
        del never_defined_global
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def del_global():')
try: show(del_global)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(del_global)')
try:
    class Body:
        try:
            undefined_in_class
        except NameError as e:
            print(type(e).__name__, e, e.name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Body:')
