from collections import OrderedDict, defaultdict
d = {"a": 1, "b": 2.0, "items": "shadow", 3: "three", (1, 2): "tuple key", "10": "ten"}
empty = {}
t = (1, 2.0, "x", None)
r = range(2, 10, 3)
b = b"AB"
ba = bytearray(b"xyz")
s = {3}
fs = frozenset([4])
lst = [1, 2.0, 3.5, [4]]
nested = {"list": [1, (2, 3)], "dict": {"k": None}, "t": (True, False)}
od = OrderedDict(z=1, y=2)
dd = defaultdict(list)
class Seq:
    def __init__(self): self.data = [10, 20, 30]
    def __len__(self): return len(self.data)
    def __getitem__(self, i): return self.data[i]
    def __setitem__(self, i, v): self.data[i] = v
    def __delitem__(self, i): del self.data[i]
seq = Seq()
class Point:
    __slots__ = ("x", "y", "unset")
    def __init__(self): self.x = 1; self.y = 2
pt = Point()
class Plain:
    def __init__(self): self.b = 1; self.a = [1, 2]; self._p = None
plain = Plain()
class MyStr(str): pass
class MyInt(int): pass
class MyFloat(float): pass
mystr = MyStr("sub")
myint = MyInt(41)
myfloat = MyFloat(1.5)
big = 2 ** 70
def show(o): return repr(o)
def type_name(o): return type(o).__name__
