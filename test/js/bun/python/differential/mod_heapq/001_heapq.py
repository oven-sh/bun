import _heapq as h

def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)

def lcg(n, seed=12345):
    out = []
    for _ in range(n):
        seed = (seed * 1103515245 + 12345) % 2 ** 31
        out.append(seed % 1000)
    return out

heap = []
for v in lcg(50):
    h.heappush(heap, v)
print(heap)
print([h.heappop(heap) for _ in range(50)], heap)
data = lcg(40, 7); h.heapify(data); print(data)
print(h.heapreplace(data, 500), data[:8]); print(h.heappushpop(data, 0), h.heappushpop(data, 600), data[:8])
print(h.heappushpop([], 5))
data = lcg(40, 9); h.heapify_max(data); print(data)
print(h.heapreplace_max(data, 500), data[:8]); print(h.heappushpop_max(data, 5000), h.heappushpop_max(data, 3), data[:8])
heap = []
for v in lcg(30, 3):
    h.heappush_max(heap, v)
print(heap); print([h.heappop_max(heap) for _ in range(30)])
big = lcg(5000, 11); h.heapify(big); print(big[:20], [h.heappop(big) for _ in range(10)])
big = lcg(5000, 13); h.heapify_max(big); print(big[:20], [h.heappop_max(big) for _ in range(10)])
for f in (h.heappop, h.heappop_max): t(lambda: f([]))
for f in (h.heapreplace, h.heapreplace_max): t(lambda: f([], 1))
for name in ("heappush", "heappushpop", "heapreplace", "heappush_max", "heappushpop_max", "heapreplace_max"):
    f = getattr(h, name)
    t(lambda: f((), 1)); t(lambda: f(None, 1)); t(lambda: f([])); t(lambda: f([], 1, 2))
for name in ("heappop", "heapify", "heappop_max", "heapify_max"):
    f = getattr(h, name)
    t(lambda: f(())); t(lambda: f(None)); t(lambda: f()); t(lambda: f([], 1))
t(lambda: h.heappush(heap=[], item=1))
t(lambda: h.heappush([1], "a")); t(lambda: h.heapify([1, "a"])); t(lambda: h.heappushpop([1], "a"))
class L(list): pass
l = L([3, 1, 2]); h.heapify(l); print(l, type(l).__name__); h.heappush(l, 0); print(l, h.heappop(l))
class Shrink:
    def __init__(self, v, heap): self.v = v; self.heap = heap
    def __lt__(self, other):
        self.heap.clear()
        return self.v < other.v
heap = []; heap.extend(Shrink(i, heap) for i in range(10)); t(lambda: h.heappop(heap))
heap = []; heap.extend(Shrink(i, heap) for i in range(10)); t(lambda: h.heappush(heap, Shrink(-1, heap)))
heap = []; heap.extend(Shrink(i, heap) for i in range(10)); t(lambda: h.heapify(heap))
heap = []; heap.extend(Shrink(i, heap) for i in range(10)); t(lambda: h.heappushpop(heap, Shrink(20, heap)))
heap = []; heap.extend(Shrink(i, heap) for i in range(10)); t(lambda: h.heapreplace(heap, Shrink(20, heap)))
class Cmp:
    log = []
    def __init__(self, v): self.v = v
    def __lt__(self, o): Cmp.log.append((self.v, o.v)); return self.v < o.v
    def __repr__(self): return "C%d" % self.v
x = [Cmp(v) for v in (5, 3, 8, 1, 9, 2)]; h.heapify(x); print(x, Cmp.log); Cmp.log.clear()
h.heappush(x, Cmp(0)); print(x, Cmp.log); Cmp.log.clear()
print(h.heappop(x), x, Cmp.log); Cmp.log.clear()
x = [Cmp(v) for v in (5, 3, 8, 1, 9, 2)]; h.heapify_max(x); print(x, Cmp.log); Cmp.log.clear()
h.heappush_max(x, Cmp(10)); print(x, Cmp.log); Cmp.log.clear()
print(h.heappop_max(x), x, Cmp.log); Cmp.log.clear()
print(h.heappushpop_max(x, Cmp(4)), x, Cmp.log); Cmp.log.clear()
print(h.heappushpop(x, Cmp(4)), Cmp.log)
print(sorted(n for n in dir(h) if not n.startswith("__")))
tuples = [(2, "b"), (1, "z"), (1, "a"), (3, "c")]; h.heapify(tuples); print([h.heappop(tuples) for _ in range(4)])
