# object.__getattribute__ applied to a class: the class is looked at as an instance of its metaclass, whose dict is the dict of the class.
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


class D(C):
    y = 6


def show(value):
    return repr(value).split(" at 0x")[0]


for cls in (C, D):
    for name in ("x", "y", "hidden", "shadowed", "data", "m", "cm", "sm", "p", "of_meta", "__name__", "__mro__", "__module__", "__qualname__",
                 "__doc__", "mro", "__class__", "__subclasses__", "nothing"):
        try:
            print(cls.__name__, name, show(getattr(cls, name)))
        except AttributeError as e:
            print(cls.__name__, name, "AttributeError", e)

# Nothing of the kind for the built-in types.
for cls, name in ((int, "real"), (int, "__add__"), (int, "__name__"), (type, "mro"), (object, "__init__"), (dict, "fromkeys")):
    try:
        print(cls.__name__, name, show(object.__getattribute__(cls, name)))
    except AttributeError as e:
        print(cls.__name__, name, "AttributeError", e)

# It is for reading only.
for call in (lambda: object.__setattr__(C, "x", 1), lambda: object.__delattr__(C, "x")):
    try:
        call()
    except TypeError as e:
        print("TypeError", e)
print(C.__dict__["x"])

# The name of the type of what a built-in method is bound to.
print(show(C.mro), show(int.mro), show(dict.fromkeys), show(str.maketrans), show(type.__subclasses__.__get__(C)))
