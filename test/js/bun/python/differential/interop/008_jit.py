class P:
    kind = 1
    def __init__(self, x): self.x = x
    def get(self): return self.x
    def add(self, n): return self.x + n
    @property
    def twice(self): return self.x * 2
class Q(P): pass
class Changing:
    def __getattr__(self, name):
        if name == "v":
            Changing.count += 1
            return Changing.count
        raise AttributeError(name)
Changing.count = 0
def inc(x): return x + 1
def fhalf(x): return x / 2
def ident(x): return x
t = tuple(range(10))
d = {"a": 1, "b": 2}
lst = list(range(10))
def rng(n): return range(n)
def gen(n):
    for i in range(n): yield i
def dflt(a, b=2, c=3): return a + b + c
def var(*a): return len(a)
def kwonly(a, *, k=5): return a + k
