def described(o):
    name = type(o).__name__
    return f"{name} {o!r}" if name in ("int", "float", "str", "bool", "NoneType") else name


class Answers:
    def __invert__(self): return "__invert__"
    def __neg__(self): return "__neg__"


class Raises:
    def __invert__(self): raise ValueError("no")
    __neg__ = __invert__


class Nothing:
    pass


def define(name):
    def answer(self, other, *more): return f"__{name}__({described(other)})"
    def no(self, other, *more): raise ValueError("no")
    setattr(Answers, f"__{name}__", answer)
    setattr(Raises, f"__{name}__", no)


for name in "add sub mul truediv mod pow lshift rshift and or xor".split():
    define(name)
    define("r" + name)

answers, raises, nothing = Answers(), Raises(), Nothing()
