# A dict that gets so many str keys (more than 699,050) that it goes over to placing them by hash(), which happens while it grows.
import collections, pickle

class S(str): pass
def key(i): return 'key%d' % i
N = 750_000
d = {}
sizes = {}
for i in range(N):
    d[key(i)] = i
    if i % 125_000 == 124_999:
        sizes[i + 1] = (len(d), d[key(0)], d[key(i)], d[key(i // 2)], key(i + 1) in d, d.get('nope'))
print(sizes)
print(all(d[key(i)] == i for i in range(N)), sum(key(i) in d for i in range(N, N + 1000)), next(iter(d)), next(reversed(d)), list(d)[699_046:699_054])
print(list(d) == [key(i) for i in range(N)], list(d.values()) == list(range(N)), d[S('key7')], d.get(S('nope')))
for i in range(0, N, 2): del d[key(i)]
print(len(d), key(0) in d, d[key(1)], sum(key(i) in d for i in range(1000)), next(iter(d)), d.popitem())
for i in range(0, N, 4): d[key(i)] = -i
print(len(d), d[key(4)], d[key(1)], key(2) in d, list(d)[-1], list(d)[:2])

# Made with all of its room at once.
e = d.copy(); print(e == d, len(e), e[key(4)], list(e)[:2] == list(d)[:2], dict(d) == e, {**d} == e, (d | {'x': 1})['x'], len(d | e))
f = dict.fromkeys(d); print(len(f), f[key(1)], key(2) in f, f.keys() == d.keys())
s = set(d); print(len(s), key(1) in s, key(2) in s, s == d.keys(), len(s & e.keys()), len(s - f.keys()), len(dict.fromkeys(s)))
print(pickle.loads(pickle.dumps(d)) == d, len(collections.OrderedDict(d)), collections.Counter(d)[key(4)], len({k: v for k, v in d.items()}))
e.clear(); e['a'] = 1; print(e, 'a' in e, key(1) in e)

# Other keys among them.
g = {}
for i in range(N):
    g[key(i) if i % 3 else i] = i
print(len(g), g[0], g[3], g[key(1)], g.get(key(3)), g.get(1), g[749_997.0], g[S(key(1))], all(g[key(i) if i % 3 else i] == i for i in range(N)))
h = {S(key(i)): i for i in range(N)}
print(len(h), h[key(5)], h[S(key(5))], key(N) in h, type(next(iter(h))).__name__, all(h[key(i)] == i for i in range(0, N, 7)))

# A dict that has been emptied, which leaves dead entries in its table, takes all that another has, and has to grow on the way.
def emptied(count, popped):
    d = {'a%d' % i: i for i in range(count)}
    for _ in range(popped): d.popitem()
    for k in list(d): del d[k]
    return d
other = {key(i): i for i in range(600_000)}
for count, popped in ((349_526, 1000), (349_526, 349_526), (174_763, 10), (699_051, 1000)):
    for fill in (lambda d: d.update(other), lambda d: d.__ior__(other), lambda d: d.__init__(other))[:3 if popped == 1000 and count == 349_526 else 1]:
        d = emptied(count, popped)
        fill(d)
        lost = sum(k not in d for k in other)
        d[key(599_999)] = d[key(300_000)] = d[key(0)] = 'again'
        print(count, popped, len(d), lost, len(list(d)), next(iter(d)), next(reversed(d)), 'a0' in d)
c = collections.Counter(emptied(349_526, 1000)); c.update(other); print(len(c), sum(k not in c for k in other), c[key(7)])
# And the other way about: what a large dict has goes into small ones.
big = {key(i): i for i in range(N)}
for i in range(100, N): del big[key(i)]
for d in (big.copy(), dict(big), {**big}, emptied(20, 3) | big, {'x': 1} | big, dict.fromkeys(big, 0), {k: v for k, v in big.items()}):
    print(len(d), sum(key(i) not in d for i in range(100)), key(100) in d, list(d)[-1])
big[key(N)] = N; print(len(big), big[key(N)], big[key(5)], sum(key(i) not in big for i in range(100)))
