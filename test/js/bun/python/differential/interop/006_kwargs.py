def f(a, b=2, *args, c=3, **kw):
    return repr((a, b, args, c, sorted(kw.items())))
def simple(a, b): return (a, b)
def only_kw(*, x, y=1): return x + y
def no_args(): return "none"
class C:
    def __init__(self, a, *, name="n"): self.a = a; self.name = name
    def method(self, p, q=0): return (self.a, p, q)
    def __call__(self, *a, **k): return repr((a, k))
    @classmethod
    def cm(cls, v=1): return v
    @staticmethod
    def sm(v=1): return v
def ident(x): return x
def type_name(x): return type(x).__name__
def passthrough(g, marker): return g(1, marker)
