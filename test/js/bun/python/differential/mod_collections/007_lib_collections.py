import collections
from collections import deque, defaultdict, namedtuple, Counter, OrderedDict, ChainMap, UserDict, UserList, UserString
import collections.abc as abc

def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)

print(deque.__module__, defaultdict.__module__, isinstance(deque(), abc.MutableSequence), isinstance(defaultdict(), abc.MutableMapping), issubclass(deque, abc.Sequence), isinstance(deque(), abc.Hashable), isinstance(iter(deque()), abc.Iterator), isinstance(deque(), abc.Reversible))
P = namedtuple("P", "x y")
p = P(1, 2); print(p, p.x, p.y, p[0], p._asdict(), p._replace(x=5), P._fields, P._make([3, 4]), p == (1, 2), hash(p) == hash((1, 2)), P.x, P.x.__doc__, type(P.x).__name__, P.__doc__, len(p), tuple(p), p.__getnewargs__(), P.__match_args__)
t(lambda: P(1)); t(lambda: P(1, 2, 3)); t(lambda: setattr(p, "x", 1)); t(lambda: P(1, y=2)); t(lambda: P(1, 2, z=3)); t(lambda: p._replace(z=1)); t(lambda: namedtuple("Q", "a a")); t(lambda: namedtuple("Q", "class")); t(lambda: namedtuple("Q", "_a")); print(namedtuple("Q", "a a class _b", rename=True)._fields)
D = namedtuple("D", ["a", "b", "c"], defaults=[2, 3]); print(D(1), D._field_defaults, D(1, c=9))
class P3(P):
    __slots__ = ()
    @property
    def norm(self): return (self.x ** 2 + self.y ** 2) ** 0.5
print(P3(3, 4).norm, P3(3, 4))
match p:
    case P(x=a, y=b): print("match", a, b)
c = Counter("abracadabra"); print(c, c.most_common(2), c["a"], c["z"], sorted(c.elements()), c.total(), sum(c.values()))
c.update("aaa"); c.update({"z": 5}); c.update(b=10); c.subtract("ab"); print(c, c + Counter(a=1), c - Counter(a=100), c & Counter(a=2, b=2), c | Counter(q=1), -Counter(a=-1), +Counter(a=-1, b=1), Counter(a=1) == Counter(a=1, b=0), Counter(a=1) <= Counter(a=2))
print(Counter([1, 1, 2.0, 2, True]), Counter(), Counter({"a": 3}), Counter(a=3), Counter("ab").copy(), dict(Counter("aab")), Counter("aab").most_common(), repr(Counter("b" * 3 + "a" * 3)))
t(lambda: Counter(5)); t(lambda: Counter.fromkeys("a"))
o = OrderedDict([("a", 1), ("b", 2), ("c", 3)]); o.move_to_end("a"); print(o, list(o), o.popitem(), o.popitem(last=False), o, list(reversed(OrderedDict.fromkeys("xyz"))), OrderedDict(a=1) == OrderedDict(a=1), OrderedDict([("a", 1), ("b", 2)]) == OrderedDict([("b", 2), ("a", 1)]), OrderedDict([("a", 1), ("b", 2)]) == {"b": 2, "a": 1}, OrderedDict(a=1) | {"b": 2})
m = ChainMap({"a": 1}, {"a": 2, "b": 3}); print(m, m["a"], m["b"], len(m), sorted(m), m.maps, m.new_child({"c": 4})["c"], m.parents, dict(m)); t(lambda: m["z"])
u = UserDict(a=1); u["b"] = 2; print(u, u.data, len(u), "a" in u, u.copy(), u | {"c": 3}); ul = UserList([3, 1, 2]); ul.sort(); ul.append(4); print(ul, ul[0], ul + [5], ul.data, len(ul)); us = UserString("abc"); print(us, us.upper(), us + "d", len(us), us.data, us[1])
d = deque(maxlen=3); d.extend(range(10)); print(d, collections.deque is deque)
dd = defaultdict(lambda: defaultdict(int)); dd["a"]["b"] += 1; print(dd["a"]["b"], len(dd))
import copy, pickle
for obj in (deque([1, [2]]), deque([1, 2], 5), defaultdict(list, a=[1]), defaultdict(None, a=1), Counter("aab"), OrderedDict(a=[1]), p, D(1)):
    c1 = copy.copy(obj); c2 = copy.deepcopy(obj); print(type(obj).__name__, c1 == obj, c2 == obj, c1 is obj, type(c1) is type(obj), getattr(c1, "maxlen", None), getattr(c2, "default_factory", None))
for obj in (deque([1, [2]]), deque([1, 2], 5), defaultdict(list, a=[1]), defaultdict(None, a=1), Counter("aab"), OrderedDict(a=[1])):
    for proto in range(pickle.HIGHEST_PROTOCOL + 1):
        r = pickle.loads(pickle.dumps(obj, proto)); assert r == obj and type(r) is type(obj), (obj, proto, r)
    print(type(obj).__name__, "pickles", getattr(r, "maxlen", None), getattr(r, "default_factory", None))
x = deque([1, 2, 3]); it = iter(x); next(it); print(list(pickle.loads(pickle.dumps(it))), list(copy.copy(it)), list(copy.copy(reversed(x))))
x = deque([1]); x.append(x); y = copy.deepcopy(x); print(y[1] is y, y[0])
import weakref
x = deque([1]); r = weakref.ref(x); print(r() is x)
print(sorted(collections.__all__))
