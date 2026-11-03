# What making and using a class looks up through the metaclass's __getattribute__, and what it looks up on the metaclass itself.

try:
    class Answers(type):
        def __getattribute__(self, name):
            return True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Answers(type):')


try:
    class Class(metaclass=Answers):
        attribute = False

        def method():
            return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Class(metaclass=Answers):')


try: print('Class.attribute =>', Class.attribute)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Class.attribute')
try: print('Class.method =>', Class.method)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Class.method')
try: print('Class.mro =>', Class.mro)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Class.mro')
try: print('Class.__name__ =>', Class.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Class.__name__')
try: print('Class.__mro__ =>', Class.__mro__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Class.__mro__')
try: print('type.__getattribute__(Class, "attribute") =>', type.__getattribute__(Class, "attribute"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__getattribute__(Class, "attribute")')
try: print('type.__getattribute__(Class, "__mro__")[1:] =>', type.__getattribute__(Class, "__mro__")[1:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__getattribute__(Class, "__mro__")[1:]')

try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')


try:
    class Logs(type):
        def __getattribute__(self, name):
            log.append(name)
            return type.__getattribute__(self, name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Logs(type):')


try:
    def show(what):
        print(what, log)
        log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(what):')


try:
    class Base(metaclass=Logs):
        x = 1

        def __init_subclass__(cls):
            pass

        def method(self):
            return 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Base(metaclass=Logs):')


try: show("class")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("class")')


try:
    class Derived(Base):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Derived(Base):')


try: show("subclass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("subclass")')
try: instance = Derived()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: instance = Derived()')
try: show("call")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("call")')
try: print('isinstance(instance, Base) =>', isinstance(instance, Base))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(instance, Base)')
try: print('issubclass(Derived, Base) =>', issubclass(Derived, Base))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: issubclass(Derived, Base)')
try: print('isinstance(1, Base) =>', isinstance(1, Base))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(1, Base)')
try: show("isinstance")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("isinstance")')
try: print('repr(Base).split(".")[-1] =>', repr(Base).split(".")[-1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(Base).split(".")[-1]')
try: print('str(Derived).split(".")[-1] =>', str(Derived).split(".")[-1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: str(Derived).split(".")[-1]')
try: show("repr")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("repr")')
try: print('Base.x =>', Base.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base.x')
try: print('Derived.x =>', Derived.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Derived.x')
try: print('instance.x =>', instance.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: instance.x')
try: print('instance.method() =>', instance.method())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: instance.method()')
try: show("attributes")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("attributes")')
try: Derived.__bases__ = (Base,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Derived.__bases__ = (Base,)')
try: show("bases")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("bases")')
try: print('hash(Base) == hash(Base) =>', hash(Base) == hash(Base))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(Base) == hash(Base)')
try: print('Base == Base =>', Base == Base)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base == Base')
try: print('Base != Derived =>', Base != Derived)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base != Derived')
try: print('bool(Base) =>', bool(Base))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(Base)')
try: show("operators")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("operators")')
try: print(sorted(n for n in dir(Derived) if not n.startswith("__")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(n for n in dir(Derived) if not n.startswith("__"))')
try: show("dir")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("dir")')


try:
    class OwnMRO(type):
        def mro(cls):
            log.append(("mro", cls.__name__))
            return type.mro(cls)

        def __getattribute__(self, name):
            log.append(name)
            return type.__getattribute__(self, name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class OwnMRO(type):')


try:
    class A(metaclass=OwnMRO):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A(metaclass=OwnMRO):')


try: show("own mro")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("own mro")')


try:
    class NoMRO(type):
        mro = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoMRO(type):')


try:
    try:
        class B(metaclass=NoMRO):
            pass
    except TypeError as e:
        print("TypeError", 'e =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')


try:
    class DescriptorMRO(type):
        class mro:
            def __get__(self, instance, owner):
                log.append(("__get__", instance.__name__, owner.__name__))
                return lambda: (instance, object)
        mro = mro()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class DescriptorMRO(type):')


try:
    class C(metaclass=DescriptorMRO):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C(metaclass=DescriptorMRO):')


try: show("descriptor")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show("descriptor")')
try: print(C.__mro__ == (C, object))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.__mro__ == (C, object)')
