# object.__getattribute__ applied to a class: the class is looked at as an instance of its metaclass, whose dict is the dict of the class.
try:
    class Meta(type):
        def __getattribute__(self, attr):
            if attr == "hidden":
                raise AttributeError("hidden")
            return object.__getattribute__(self, attr)

        def of_meta(self):
            return "of_meta"

        shadowed = "the metaclass's"

        @property
        def data(self):
            return "the property of the metaclass"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Meta(type):')


try:
    class C(metaclass=Meta):
        x = 5
        hidden = "magic"
        shadowed = "the class's"
        data = "the class's"

        def m(self): pass

        @classmethod
        def cm(cls): return cls

        @staticmethod
        def sm(): pass

        @property
        def p(self): return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C(metaclass=Meta):')


try:
    class D(C):
        y = 6
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class D(C):')


try:
    def show(value):
        return repr(value).split(" at 0x")[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(value):')


try:
    for cls in (C, D):
        for name in ("x", "y", "hidden", "shadowed", "data", "m", "cm", "sm", "p", "of_meta", "__name__", "__mro__", "__module__", "__qualname__",
                     "__doc__", "mro", "__class__", "__subclasses__", "nothing"):
            try:
                print('cls.__name__ [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', cls.__name__)
                print('name [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', name)
                print('show(getattr(cls, name)) [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', show(getattr(cls, name)))
            except AttributeError as e:
                print('cls.__name__ [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', cls.__name__)
                print('name [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', name)
                print("AttributeError", 'e [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for cls in (C, D):')

# Nothing of the kind for the built-in types.
try:
    for cls, name in ((int, "real"), (int, "__add__"), (int, "__name__"), (type, "mro"), (object, "__init__"), (dict, "fromkeys")):
        try:
            print('cls.__name__ [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', cls.__name__)
            print('name [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', name)
            print('show(object.__getattribute__(cls, name)) [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', show(object.__getattribute__(cls, name)))
        except AttributeError as e:
            print('cls.__name__ [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', cls.__name__)
            print('name [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', name)
            print("AttributeError", 'e [' + 'cls=' + (repr(cls) if type(cls) in (str, int, float, bytes, bool, type(None)) or (type(cls) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cls)) else cls.__name__ if type(cls) is type else type(cls).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for cls, name in ((int, "real"), (int, "__add__"), (int, "__name__"),...')

# It is for reading only.
try:
    for call in (lambda: object.__setattr__(C, "x", 1), lambda: object.__delattr__(C, "x")):
        try:
            call()
        except TypeError as e:
            print("TypeError", 'e [' + 'call=' + (repr(call) if type(call) in (str, int, float, bytes, bool, type(None)) or (type(call) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in call)) else call.__name__ if type(call) is type else type(call).__name__) + '] =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for call in (lambda: object.__setattr__(C, "x", 1), lambda: object.__...')
try: print(C.__dict__["x"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.__dict__["x"]')

# The name of the type of what a built-in method is bound to.
try: print('show(C.mro) =>', show(C.mro))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(C.mro)')
try: print('show(int.mro) =>', show(int.mro))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(int.mro)')
try: print('show(dict.fromkeys) =>', show(dict.fromkeys))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(dict.fromkeys)')
try: print('show(str.maketrans) =>', show(str.maketrans))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(str.maketrans)')
try: print('show(type.__subclasses__.__get__(C)) =>', show(type.__subclasses__.__get__(C)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(type.__subclasses__.__get__(C))')
