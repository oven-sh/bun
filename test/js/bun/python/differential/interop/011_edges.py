class MyList(list):
    label = "class label"
    def total(self): return sum(self)
    def sort(self, *a): return "python sort"
ml = MyList([3, 1, 2]); ml.note = "n"
class Frozen:
    __slots__ = ()
frozen = Frozen()
t = (1, 2, 3)
d = {"b": 1, "a": 2, 2: "two", 1: "one"}
class Obj:
    def __init__(self): self.a = 1
obj = Obj()
class Getter:
    calls = 0
    @property
    def p(self):
        Getter.calls += 1
        return Getter.calls
getter = Getter()
class WeirdLen:
    def __len__(self): raise ValueError("bad len")
weird = WeirdLen()
class Callable:
    def __call__(self, *a): return len(a)
callable_obj = Callable()
def show(x): return repr(x)
def attrs(x): return sorted(vars(x))
def is_list(x): return isinstance(x, list), type(x).__name__
