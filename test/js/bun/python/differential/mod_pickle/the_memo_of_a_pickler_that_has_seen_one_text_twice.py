# What a Pickler has memoized goes by the object. An interpreter may have one text in two places where CPython has one str (the literals of two functions, a name interned twice, the name of an attribute beside
# the same text), as long as no program can tell: `is` and id() say that it is one object. So copying the memo, taking it over and reducing it have to work, and to give one entry for it.
import io, pickle, sys
def pickler_that_has_seen(data):
    p = pickle.Pickler(io.BytesIO()); p.dump(data); return p
def taken_over(data):
    q = pickle.Pickler(io.BytesIO()); q.memo = pickler_that_has_seen(data).memo; return q
def f(): return 'a literal here'
def g(): return 'a literal here'
class C:
    def __init__(self): self.attribute_name = 1
once = sys.intern(''.join(['sp', 'am!'])); again = sys.intern(''.join(['sp', 'am!']))
scenes = {
    'the literals of two functions': lambda: [f(), g()],
    'interned twice': lambda: [once, again],
    'the name of an attribute beside the same text': lambda: [C().__dict__, sys.intern('attribute' + '_name')],
    'the keys of three dicts': lambda: [{'alpha_key': 1}, {'alpha_key': 2}, dict(alpha_key=3)],
    'two instances': lambda: [C(), C()],
}
for name, data in scenes.items():
    d = data()
    print(name + ':', 'copy', len(pickler_that_has_seen(d).memo.copy()), '| taken over, then copied', len(taken_over(d).memo.copy()),
          '| reduced', [type(x).__name__ for x in pickler_that_has_seen(d).memo.__reduce__()], len(pickler_that_has_seen(d).memo.__reduce__()[1][0]))
