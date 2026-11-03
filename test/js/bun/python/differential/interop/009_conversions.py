from fractions import Fraction
class Num:
    def __init__(self, v): self.v = v
    def __float__(self): return float(self.v)
    def __str__(self): return "Num<%s>" % self.v
class Idx:
    def __index__(self): return 7
class Text:
    def __str__(self): return "text!"
    def __repr__(self): return "Text()"
class OnlyRepr:
    def __repr__(self): return "OnlyRepr()"
class BadStr:
    def __str__(self): raise ValueError("no str")
class OwnToString:
    def toString(self): return "python's toString"
    def valueOf(self): return 12
floats = [1.0, 0.0, -2.0, 2.5, 1e20, float("inf")]
num = Num(3); idx = Idx(); text = Text(); only = OnlyRepr(); bad = BadStr(); own = OwnToString()
frac = Fraction(1, 2)
cplx = 1 + 2j
none_list = [None]
def kinds(xs): return [type(x).__name__ for x in xs]
def same(a, b): return a is b
def eq(a, b): return a == b
