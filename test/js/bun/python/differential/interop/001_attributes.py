class A:
    cls_attr = 7
    def __init__(self, x=1):
        self.x = x
        self.none = None
    def double(self):
        return self.x * 2
    @property
    def prop(self):
        return "prop " + str(self.x)
    @staticmethod
    def static(a):
        return a + 1
    @classmethod
    def make(cls, x):
        return cls(x)
    def boom(self):
        raise ValueError("boom")
    @property
    def bad(self):
        raise RuntimeError("bad property")

class ReadOnly:
    __slots__ = ("a",)
    def __init__(self): self.a = 1

class Dynamic:
    def __getattr__(self, name):
        if name.startswith("dyn_"):
            return name[4:]
        raise AttributeError(name)

a = A(21)
ro = ReadOnly()
dyn = Dynamic()
number = 5
half = 2.5
whole = 2.0
text = "text"
flag = True
nothing = None
def show(o): return repr(o)
def get_x(o): return o.x
def attrs(o): return sorted(vars(o).items())
