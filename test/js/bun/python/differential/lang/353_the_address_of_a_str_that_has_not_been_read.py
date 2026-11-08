# Whoever names a str by its address names the one that id() gives, also if the str has been put together and nobody has read it yet.
import pickle, io
def parts(): return 'a long enough beginning, ' * 3, 'and a long enough end' * 3
a, b = parts()
s = a + b
r = object.__repr__(s)
print(hex(id(s)) in r, r.startswith('<str object at 0x'))
s = a + b
r = object.__repr__(s); n = id(s); len(s); s[0]; hash(s)
print(hex(n) in r, n == id(s), object.__repr__(s) == r)
class S(str): pass
s = S(a + b)
print(hex(id(s)) in object.__repr__(s))
for protocol in range(pickle.HIGHEST_PROTOCOL + 1):
    s = a + b
    f = io.BytesIO(); p = pickle.Pickler(f, protocol)
    p.dump([s, s, (s, s)])
    print(protocol, id(s) in p.memo.copy(), sorted(type(v[1]).__name__ for v in p.memo.copy().values()), all(k == id(v[1]) for k, v in p.memo.copy().items()), len(f.getvalue()))
