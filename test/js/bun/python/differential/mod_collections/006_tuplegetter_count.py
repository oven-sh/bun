from _collections import _tuplegetter, _count_elements, defaultdict

def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)

def tn(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__)

g = _tuplegetter(1, "doc for 1")
print(g, g.__doc__, g.__reduce__()[1], g.__reduce__()[0] is _tuplegetter, type(g).__name__, type(g).__module__)
class P(tuple):
    x = _tuplegetter(0, "x doc")
    y = _tuplegetter(1, "y doc")
    z = _tuplegetter(5, None)
    n = _tuplegetter(-1, None)
p = P((10, 20)); print(p.x, p.y, P.x, P.x.__doc__)
t(lambda: p.z); t(lambda: p.n)
t(lambda: setattr(p, "x", 1)); t(lambda: delattr(p, "x"))
t(lambda: g.__get__(5)); t(lambda: g.__get__([1, 2])); t(lambda: g.__get__(None)); t(lambda: g.__get__(None, None)); print(g.__get__(None, P) is g, g.__get__((1, 2)), g.__get__((1, 2), tuple))
t(lambda: g.__set__(p, 1)); t(lambda: g.__delete__(p))
g.__doc__ = "new"; print(g.__doc__, g); del g.__doc__; print(g.__doc__)
t(lambda: _tuplegetter()); t(lambda: _tuplegetter(1)); t(lambda: _tuplegetter(1, 2, 3)); t(lambda: _tuplegetter("a", 1)); t(lambda: _tuplegetter(index=1, doc=2)); t(lambda: _tuplegetter(2 ** 70, 1))
def sub():
    class T(_tuplegetter): pass
tn(sub)
tn(lambda: setattr(g, "foo", 1))
print(_tuplegetter(3, [1, "a"]))

d = {}; _count_elements(d, "abracadabra"); print(d)
_count_elements(d, ["a", 1, 1.0, True]); print(d)
d = {"a": 1.5, "b": "x"}; t(lambda: _count_elements(d, "ab")); print(d)
t(lambda: _count_elements({}, 5)); t(lambda: _count_elements(5, "a")); t(lambda: _count_elements({}, [[]])); t(lambda: _count_elements({})); t(lambda: _count_elements(mapping={}, iterable=""))
class C(dict):
    def __setitem__(self, k, v):
        print("set", k, v); super().__setitem__(k, v)
c = C(); _count_elements(c, "aab"); print(c)
class G(dict):
    def get(self, k, default=None):
        print("get", k, default); return super().get(k, default)
c = G(); _count_elements(c, "aab"); print(c)
class Plain(dict): pass
c = Plain(); _count_elements(c, "aab"); print(c)
dd = defaultdict(int); _count_elements(dd, "aab"); print(dd)
class Mp:
    def __init__(self): self.d = {}
    def get(self, k, default): return self.d.get(k, default)
    def __setitem__(self, k, v): self.d[k] = v
m = Mp(); _count_elements(m, [1, 1, 2]); print(m.d)
big = {"x": 2 ** 70}; _count_elements(big, "x"); print(big)
