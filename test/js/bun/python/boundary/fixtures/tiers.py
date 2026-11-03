class V:
    __slots__ = ("x",)
    def __init__(self, x): self.x = x
    def __add__(self, o): return V(self.x + (o.x if isinstance(o, V) else o))
    def __radd__(self, o): return V(o + self.x)
    def __sub__(self, o): return V(self.x - (o.x if isinstance(o, V) else o))
    def __mul__(self, o): return V(self.x * (o.x if isinstance(o, V) else o))
    def __neg__(self): return V(-self.x)
    def __eq__(self, o): return isinstance(o, V) and self.x == o.x
    def __hash__(self): return hash(self.x)
    def __lt__(self, o): return self.x < o.x if isinstance(o, V) else NotImplemented
    def __le__(self, o): return self.x <= o.x if isinstance(o, V) else NotImplemented
    def __str__(self): return f"V{self.x}"
    def __repr__(self): return f"V({self.x})"
class NeverEqual:
    def __eq__(self, o): return False
    __hash__ = None
class Base:
    def __init__(self, a, b=2): self.a = a; self.b = b
    def m(self, k=1): return self.a * k
    @property
    def p(self): return self.a + self.b
def kw(a, b=0, *, c=0): return a + b * 10 + c * 100
def gen(n):
    for i in range(n): yield i
def half(x): return x / 2
def ident(x): return x
