# What making and using a class looks up through the metaclass's __getattribute__, and what it looks up on the metaclass itself.

class Answers(type):
    def __getattribute__(self, name):
        return True


class Class(metaclass=Answers):
    attribute = False

    def method():
        return False


print(Class.attribute, Class.method, Class.mro, Class.__name__, Class.__mro__)
print(type.__getattribute__(Class, "attribute"), type.__getattribute__(Class, "__mro__")[1:])

log = []


class Logs(type):
    def __getattribute__(self, name):
        log.append(name)
        return type.__getattribute__(self, name)


def show(what):
    print(what, log)
    log.clear()


class Base(metaclass=Logs):
    x = 1

    def __init_subclass__(cls):
        pass

    def method(self):
        return 2


show("class")


class Derived(Base):
    pass


show("subclass")
instance = Derived()
show("call")
print(isinstance(instance, Base), issubclass(Derived, Base), isinstance(1, Base))
show("isinstance")
print(repr(Base).split(".")[-1], str(Derived).split(".")[-1])
show("repr")
print(Base.x, Derived.x, instance.x, instance.method())
show("attributes")
Derived.__bases__ = (Base,)
show("bases")
print(hash(Base) == hash(Base), Base == Base, Base != Derived, bool(Base))
show("operators")
print(sorted(n for n in dir(Derived) if not n.startswith("__")))
show("dir")


class OwnMRO(type):
    def mro(cls):
        log.append(("mro", cls.__name__))
        return type.mro(cls)

    def __getattribute__(self, name):
        log.append(name)
        return type.__getattribute__(self, name)


class A(metaclass=OwnMRO):
    pass


show("own mro")


class NoMRO(type):
    mro = None


try:
    class B(metaclass=NoMRO):
        pass
except TypeError as e:
    print("TypeError", e)


class DescriptorMRO(type):
    class mro:
        def __get__(self, instance, owner):
            log.append(("__get__", instance.__name__, owner.__name__))
            return lambda: (instance, object)
    mro = mro()


class C(metaclass=DescriptorMRO):
    pass


show("descriptor")
print(C.__mro__ == (C, object))
