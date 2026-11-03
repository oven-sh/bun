# name and obj of an AttributeError, whoever raises it, and of a NameError; what the suggestions are made from.
import sys, types
def show(action):
    try:
        action()
        print("no error")
    except TypeError as e:
        print("TypeError |", e)
    except (AttributeError, NameError) as e:
        obj = getattr(e, "obj", "(none)")
        print(type(e).__name__, "|", e, "| name:", repr(e.name), "| obj:", type(obj).__name__ if obj is not None else None)

class Plain: pass
class WithGetattr:
    def __getattr__(self, name): raise AttributeError("custom message for " + name)
class WithGetattrBare:
    def __getattr__(self, name): raise AttributeError
class WithGetattrNamed:
    def __getattr__(self, name): raise AttributeError("named", name="other", obj=42)
class WithGetattrOnlyName:
    def __getattr__(self, name): raise AttributeError("only name", name="other")
class WithGetattribute:
    def __getattribute__(self, name): raise AttributeError("from getattribute")
class WithProperty:
    @property
    def prop(self): raise AttributeError("inside the property")
    @property
    def deep(self): return Plain().missing
class WithSlots:
    __slots__ = ("a",)
class Meta(type):
    def __getattr__(cls, name): raise AttributeError("from the metaclass")
class WithMeta(metaclass=Meta): pass
class Sub(AttributeError): pass
class RaisesSub:
    def __getattr__(self, name): raise Sub("a subclass")

show(lambda: Plain().x)
show(lambda: Plain.x)
show(lambda: WithGetattr().x)
show(lambda: WithGetattrBare().x)
show(lambda: WithGetattrNamed().x)
show(lambda: WithGetattrOnlyName().x)
show(lambda: WithGetattribute().x)
show(lambda: WithProperty().prop)
show(lambda: WithProperty().deep)
show(lambda: WithSlots().a)
show(lambda: WithSlots().b)
show(lambda: WithMeta.x)
show(lambda: RaisesSub().x)
show(lambda: getattr(Plain(), "x"))
show(lambda: getattr(WithGetattr(), "x"))
show(lambda: (1).x)
show(lambda: "s".x)
show(lambda: None.x)
show(lambda: [].x)
show(lambda: sys.nothing_here)
show(lambda: types.ModuleType("m").x)
show(lambda: len.x)
show(lambda: (lambda: 0).x)
show(lambda: super(Plain, Plain()).x)
show(lambda: object().x)
show(lambda: type.x)
print(getattr(WithGetattr(), "x", "default"), hasattr(WithGetattr(), "x"), hasattr(WithProperty(), "prop"))

# Storing and deleting
def store(o, n, v=1): setattr(o, n, v)
show(lambda: store(object(), "x"))
show(lambda: store(WithSlots(), "b"))
show(lambda: store(1, "x"))
show(lambda: store("s", "upper"))
show(lambda: delattr(Plain(), "x"))
show(lambda: delattr(WithSlots(), "a"))
show(lambda: delattr(WithSlots(), "b"))
show(lambda: delattr(object(), "x"))
show(lambda: store(len, "x"))
show(lambda: store(int, "x"))
show(lambda: delattr(int, "real"))

# Made by hand
for e in (AttributeError(), AttributeError("m"), AttributeError("m", name="n"), AttributeError("m", obj=1), AttributeError("m", name="n", obj=1), NameError("m", name="n"), NameError()):
    print(repr(e), e.args, e.name, getattr(e, "obj", "-"))
for bad in (lambda: AttributeError("m", other=1), lambda: NameError("m", obj=1), lambda: AttributeError(name="n", obj=1, x=2)):
    try:
        bad()
    except TypeError as e:
        print("TypeError:", e)
e = AttributeError("m", name="n", obj=[1])
import copy, pickle
for other in (copy.copy(e), pickle.loads(pickle.dumps(e))):
    print(repr(other), other.name, other.obj)
e.name = 3; e.obj = None
print(e.name, e.obj)
del e.name
print(e.name)

# Names
def local_unbound():
    print(v)
    v = 1
def free_unbound():
    def inner(): return w
    inner()
    w = 1
def deleted():
    v = 1
    del v
    return v
show(lambda: undefined_name)
show(local_unbound)
show(free_unbound)
show(deleted)
show(lambda: eval("undefined_in_eval"))
def del_global():
    del never_defined_global
show(del_global)
class Body:
    try:
        undefined_in_class
    except NameError as e:
        print(type(e).__name__, e, e.name)
