# Classic algorithms written in plain Python.
def lcg(seed):
    while True:
        seed = (seed * 1103515245 + 12345) % 2 ** 31
        yield seed
rnd = lcg(42)
data = [next(rnd) % 1000 for _ in range(200)]

def quicksort(a):
    if len(a) <= 1: return a
    p = a[len(a) // 2]
    return quicksort([x for x in a if x < p]) + [x for x in a if x == p] + quicksort([x for x in a if x > p])
def mergesort(a):
    if len(a) <= 1: return a[:]
    m = len(a) // 2; l, r = mergesort(a[:m]), mergesort(a[m:]); out = []; i = j = 0
    while i < len(l) and j < len(r):
        if l[i] <= r[j]: out.append(l[i]); i += 1
        else: out.append(r[j]); j += 1
    return out + l[i:] + r[j:]
def heapsort(a):
    a = a[:]; n = len(a)
    def sift(i, n):
        while True:
            c = 2 * i + 1
            if c >= n: return
            if c + 1 < n and a[c + 1] > a[c]: c += 1
            if a[i] >= a[c]: return
            a[i], a[c] = a[c], a[i]; i = c
    for i in range(n // 2 - 1, -1, -1): sift(i, n)
    for end in range(n - 1, 0, -1):
        a[0], a[end] = a[end], a[0]; sift(0, end)
    return a
def insertion(a):
    a = a[:]
    for i in range(1, len(a)):
        v = a[i]; j = i - 1
        while j >= 0 and a[j] > v: a[j + 1] = a[j]; j -= 1
        a[j + 1] = v
    return a
def bubble(a):
    a = a[:]; n = len(a)
    for i in range(n):
        swapped = False
        for j in range(n - 1 - i):
            if a[j] > a[j + 1]: a[j], a[j + 1] = a[j + 1], a[j]; swapped = True
        if not swapped: break
    return a
def counting(a, k=1000):
    c = [0] * k
    for x in a: c[x] += 1
    return [i for i, n in enumerate(c) for _ in range(n)]
ref = sorted(data)
print([f(data) == ref for f in (quicksort, mergesort, heapsort, insertion, counting)], bubble(data[:60]) == sorted(data[:60]), ref[:10], ref[-5:], data[:8])
def bsearch(a, x):
    lo, hi = 0, len(a)
    while lo < hi:
        mid = (lo + hi) // 2
        if a[mid] < x: lo = mid + 1
        else: hi = mid
    return lo
print([bsearch(ref, v) for v in (-1, 0, 500, 999, 5000)], all(ref[bsearch(ref, v)] == v for v in data))
def sieve(n):
    is_p = [True] * (n + 1); is_p[0] = is_p[1] = False
    for i in range(2, int(n ** 0.5) + 1):
        if is_p[i]:
            for j in range(i * i, n + 1, i): is_p[j] = False
    return [i for i, p in enumerate(is_p) if p]
pr = sieve(2000); print(len(pr), pr[:12], pr[-3:], sum(pr))
def factor(n):
    out = []; d = 2
    while d * d <= n:
        while n % d == 0: out.append(d); n //= d
        d += 1
    return out + ([n] if n > 1 else [])
print([factor(n) for n in (1, 2, 12, 97, 360, 1001, 65536, 999983, 600851475143)])
def gcd(a, b):
    while b: a, b = b, a % b
    return a
def egcd(a, b):
    if b == 0: return a, 1, 0
    g, x, y = egcd(b, a % b); return g, y, x - a // b * y
print(gcd(1071, 462), gcd(17, 5), gcd(0, 9), egcd(240, 46), 240 * egcd(240, 46)[1] + 46 * egcd(240, 46)[2], 12 * 18 // gcd(12, 18))
def queens(n):
    sols = []
    def place(row, cols, d1, d2, cur):
        if row == n: sols.append(cur); return
        for c in range(n):
            if c not in cols and row - c not in d1 and row + c not in d2:
                place(row + 1, cols | {c}, d1 | {row - c}, d2 | {row + c}, cur + [c])
    place(0, frozenset(), frozenset(), frozenset(), []); return sols
print([len(queens(n)) for n in range(1, 7)], queens(6)[0], queens(4))
def knapsack(items, cap):
    best = [0] * (cap + 1)
    for w, v in items:
        for c in range(cap, w - 1, -1): best[c] = max(best[c], best[c - w] + v)
    return best[cap]
print(knapsack([(12, 4), (2, 2), (1, 1), (1, 2), (4, 10)], 15), knapsack([(w % 13 + 1, w % 29 + 1) for w in data[:30]], 60))
def lcs(a, b):
    t = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i, x in enumerate(a):
        for j, y in enumerate(b): t[i + 1][j + 1] = t[i][j] + 1 if x == y else max(t[i][j + 1], t[i + 1][j])
    out = []; i, j = len(a), len(b)
    while i and j:
        if a[i - 1] == b[j - 1]: out.append(a[i - 1]); i -= 1; j -= 1
        elif t[i - 1][j] >= t[i][j - 1]: i -= 1
        else: j -= 1
    return "".join(reversed(out))
def edit(a, b):
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1): cur.append(min(prev[j] + 1, cur[-1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]
print(lcs("AGGTAB", "GXTXAYB"), lcs("the quick brown fox", "a quick brown dog"), edit("kitten", "sitting"), edit("", "abc"), edit("flaw", "lawn"), edit("intention", "execution"))
graph = {"A": {"B": 7, "C": 9, "F": 14}, "B": {"A": 7, "C": 10, "D": 15}, "C": {"A": 9, "B": 10, "D": 11, "F": 2}, "D": {"B": 15, "C": 11, "E": 6}, "E": {"D": 6, "F": 9}, "F": {"A": 14, "C": 2, "E": 9}, "G": {}}
def dijkstra(g, s):
    dist = {s: 0}; prev = {}; todo = [(0, s)]; done = set()
    while todo:
        todo.sort(reverse=True); d, u = todo.pop()
        if u in done: continue
        done.add(u)
        for v, w in g[u].items():
            if d + w < dist.get(v, float("inf")): dist[v] = d + w; prev[v] = u; todo.append((d + w, v))
    return dist, prev
dist, prev = dijkstra(graph, "A"); path = ["E"]
while path[-1] in prev: path.append(prev[path[-1]])
print(sorted(dist.items()), path[::-1])
def bfs(g, s):
    seen = [s]; q = [s]
    while q:
        u = q.pop(0)
        for v in sorted(g[u]):
            if v not in seen: seen.append(v); q.append(v)
    return seen
def dfs(g, u, seen=None):
    seen = seen if seen is not None else []
    seen.append(u)
    for v in sorted(g[u]):
        if v not in seen: dfs(g, v, seen)
    return seen
print(bfs(graph, "A"), dfs(graph, "A"), bfs(graph, "G"))
def toposort(deps):
    indeg = {k: 0 for k in deps}
    for k, vs in deps.items():
        for v in vs: indeg[v] = indeg.get(v, 0) + 1
    ready = sorted(k for k, n in indeg.items() if n == 0); out = []
    while ready:
        k = ready.pop(0); out.append(k)
        for v in sorted(deps.get(k, ())):
            indeg[v] -= 1
            if indeg[v] == 0: ready.append(v); ready.sort()
    if len(out) != len(indeg): raise ValueError("cycle among " + ", ".join(sorted(set(indeg) - set(out))))
    return out
print(toposort({"shirt": ["tie", "belt"], "tie": ["jacket"], "trousers": ["shoes", "belt"], "belt": ["jacket"], "socks": ["shoes"], "jacket": [], "shoes": []}))
try: toposort({"a": ["b"], "b": ["c"], "c": ["a"], "d": []})
except ValueError as e: print("ValueError:", e)
class DSU:
    def __init__(s, n): s.p = list(range(n)); s.size = [1] * n
    def find(s, x):
        while s.p[x] != x: s.p[x] = s.p[s.p[x]]; x = s.p[x]
        return x
    def union(s, a, b):
        a, b = s.find(a), s.find(b)
        if a == b: return False
        if s.size[a] < s.size[b]: a, b = b, a
        s.p[b] = a; s.size[a] += s.size[b]; return True
d = DSU(10); print([d.union(a, b) for a, b in ((0, 1), (2, 3), (1, 3), (0, 2), (4, 5), (8, 9), (5, 9))], len({d.find(i) for i in range(10)}), sorted(d.size[d.find(i)] for i in range(10)))
edges = sorted((w, u, v) for u, vs in graph.items() for v, w in vs.items() if u < v); idx = {k: i for i, k in enumerate(sorted(graph))}; d = DSU(len(idx)); mst = [(u, v, w) for w, u, v in edges if d.union(idx[u], idx[v])]; print(mst, sum(w for _, _, w in mst))
def matmul(a, b): return [[sum(x * y for x, y in zip(r, c)) for c in zip(*b)] for r in a]
def matpow(m, n):
    r = [[int(i == j) for j in range(len(m))] for i in range(len(m))]
    while n:
        if n & 1: r = matmul(r, m)
        m = matmul(m, m); n >>= 1
    return r
def transpose(m): return [list(r) for r in zip(*m)]
def det(m):
    if len(m) == 1: return m[0][0]
    return sum((-1) ** j * m[0][j] * det([r[:j] + r[j + 1:] for r in m[1:]]) for j in range(len(m)))
print(matmul([[1, 2], [3, 4]], [[5, 6], [7, 8]]), matpow([[1, 1], [1, 0]], 90)[0][1], transpose([[1, 2, 3], [4, 5, 6]]), det([[2, 0, 1], [1, 3, 2], [1, 1, 1]]), det([[1, 2, 3, 4], [5, 6, 7, 8], [2, 6, 4, 8], [3, 1, 1, 2]]))
def to_base(n, b): return "0" if n == 0 else ("-" if n < 0 else "") + "".join("0123456789abcdefghijklmnopqrstuvwxyz"[d] for d in reversed([abs(n) // b ** i % b for i in range(len(bin(abs(n))))])).lstrip("0")
def roman(n): return "".join(s * (n // v) + ("" if (n := n % v) is None else "") for v, s in ((1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")))
print([to_base(255, b) for b in (2, 8, 16, 36)], to_base(-10, 3), to_base(0, 2), int(to_base(123456789, 7), 7))
def roman2(n):
    out = ""
    for v, s in ((1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")):
        while n >= v: out += s; n -= v
    return out
print([roman2(n) for n in (1, 4, 9, 14, 40, 90, 400, 1994, 2024, 3999)])
def perms(a):
    if len(a) <= 1: yield list(a); return
    for i in range(len(a)):
        for p in perms(a[:i] + a[i + 1:]): yield [a[i]] + p
def combos(a, k):
    if k == 0: yield []; return
    for i in range(len(a) - k + 1):
        for c in combos(a[i + 1:], k - 1): yield [a[i]] + c
def subsets(a): return [[x for i, x in enumerate(a) if m >> i & 1] for m in range(1 << len(a))]
print(list(perms([1, 2, 3])), list(combos("abcd", 2)), subsets([1, 2, 3]), sum(1 for _ in perms(list(range(5)))), sum(1 for _ in combos(list(range(8)), 3)))
def coins(amount, kinds):
    ways = [1] + [0] * amount
    for k in kinds:
        for a in range(k, amount + 1): ways[a] += ways[a - k]
    return ways[amount]
def lis(a):
    best = []
    for x in a:
        i = bsearch(best, x)
        if i == len(best): best.append(x)
        else: best[i] = x
    return len(best)
def max_sub(a):
    best = cur = a[0]
    for x in a[1:]: cur = max(x, cur + x); best = max(best, cur)
    return best
print(coins(100, [1, 5, 10, 25, 50]), coins(200, [1, 2, 5, 10, 20, 50, 100, 200]), lis(data), lis([10, 9, 2, 5, 3, 7, 101, 18]), max_sub([-2, 1, -3, 4, -1, 2, 1, -5, 4]), max_sub([x - 500 for x in data]))
def pascal(n):
    row = [1]
    for _ in range(n): yield row; row = [a + b for a, b in zip([0] + row, row + [0])]
print(list(pascal(7)), max(list(pascal(40))[-1]))
def collatz(n):
    steps = 0
    while n != 1: n = n // 2 if n % 2 == 0 else 3 * n + 1; steps += 1
    return steps
print([collatz(n) for n in (1, 7, 27, 97, 871)], max(range(1, 300), key=collatz))
def hanoi(n, a, b, c): return hanoi(n - 1, a, c, b) + [(a, c)] + hanoi(n - 1, b, a, c) if n else []
print(len(hanoi(8, "A", "B", "C")), hanoi(3, "A", "B", "C"))
def spiral(m):
    out = []
    while m: out += m[0]; m = [list(r) for r in zip(*m[1:])][::-1]
    return out
print(spiral([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]))
def flood(grid, r, c, new):
    grid = [list(row) for row in grid]; old = grid[r][c]; stack = [(r, c)]
    while stack:
        r, c = stack.pop()
        if 0 <= r < len(grid) and 0 <= c < len(grid[0]) and grid[r][c] == old != new:
            grid[r][c] = new; stack += [(r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)]
    return ["".join(row) for row in grid]
print(flood(["..##.", ".#..#", "..#..", "##..."], 0, 0, "o"))
