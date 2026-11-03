# Classic algorithms written in plain Python.
try:
    def lcg(seed):
        while True:
            seed = (seed * 1103515245 + 12345) % 2 ** 31
            yield seed
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lcg(seed):')
try: rnd = lcg(42)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: rnd = lcg(42)')
try: data = [next(rnd) % 1000 for _ in range(200)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: data = [next(rnd) % 1000 for _ in range(200)]')

try:
    def quicksort(a):
        if len(a) <= 1: return a
        p = a[len(a) // 2]
        return quicksort([x for x in a if x < p]) + [x for x in a if x == p] + quicksort([x for x in a if x > p])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def quicksort(a):')
try:
    def mergesort(a):
        if len(a) <= 1: return a[:]
        m = len(a) // 2; l, r = mergesort(a[:m]), mergesort(a[m:]); out = []; i = j = 0
        while i < len(l) and j < len(r):
            if l[i] <= r[j]: out.append(l[i]); i += 1
            else: out.append(r[j]); j += 1
        return out + l[i:] + r[j:]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def mergesort(a):')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def heapsort(a):')
try:
    def insertion(a):
        a = a[:]
        for i in range(1, len(a)):
            v = a[i]; j = i - 1
            while j >= 0 and a[j] > v: a[j + 1] = a[j]; j -= 1
            a[j + 1] = v
        return a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def insertion(a):')
try:
    def bubble(a):
        a = a[:]; n = len(a)
        for i in range(n):
            swapped = False
            for j in range(n - 1 - i):
                if a[j] > a[j + 1]: a[j], a[j + 1] = a[j + 1], a[j]; swapped = True
            if not swapped: break
        return a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bubble(a):')
try:
    def counting(a, k=1000):
        c = [0] * k
        for x in a: c[x] += 1
        return [i for i, n in enumerate(c) for _ in range(n)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def counting(a, k=1000):')
try: ref = sorted(data)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ref = sorted(data)')
try: print('[f(data) == ref for f in (quicksort, mergesort, heapsort, insertion, ... =>', [f(data) == ref for f in (quicksort, mergesort, heapsort, insertion, counting)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [f(data) == ref for f in (quicksort, mergesort, heapsort, insertion, ...')
try: print('bubble(data[:60]) == sorted(data[:60]) =>', bubble(data[:60]) == sorted(data[:60]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bubble(data[:60]) == sorted(data[:60])')
try: print('ref[:10] =>', ref[:10])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ref[:10]')
try: print('ref[-5:] =>', ref[-5:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ref[-5:]')
try: print('data[:8] =>', data[:8])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: data[:8]')
try:
    def bsearch(a, x):
        lo, hi = 0, len(a)
        while lo < hi:
            mid = (lo + hi) // 2
            if a[mid] < x: lo = mid + 1
            else: hi = mid
        return lo
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bsearch(a, x):')
try: print('[bsearch(ref, v) for v in (-1, 0, 500, 999, 5000)] =>', [bsearch(ref, v) for v in (-1, 0, 500, 999, 5000)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [bsearch(ref, v) for v in (-1, 0, 500, 999, 5000)]')
try: print('all(ref[bsearch(ref, v)] == v for v in data) =>', all(ref[bsearch(ref, v)] == v for v in data))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: all(ref[bsearch(ref, v)] == v for v in data)')
try:
    def sieve(n):
        is_p = [True] * (n + 1); is_p[0] = is_p[1] = False
        for i in range(2, int(n ** 0.5) + 1):
            if is_p[i]:
                for j in range(i * i, n + 1, i): is_p[j] = False
        return [i for i, p in enumerate(is_p) if p]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sieve(n):')
try: pr = sieve(2000)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pr = sieve(2000)')
try: print('len(pr) =>', len(pr))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(pr)')
try: print('pr[:12] =>', pr[:12])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pr[:12]')
try: print('pr[-3:] =>', pr[-3:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pr[-3:]')
try: print('sum(pr) =>', sum(pr))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(pr)')
try:
    def factor(n):
        out = []; d = 2
        while d * d <= n:
            while n % d == 0: out.append(d); n //= d
            d += 1
        return out + ([n] if n > 1 else [])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def factor(n):')
try: print([factor(n) for n in (1, 2, 12, 97, 360, 1001, 65536, 999983, 600851475143)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [factor(n) for n in (1, 2, 12, 97, 360, 1001, 65536, 999983, 60085147...')
try:
    def gcd(a, b):
        while b: a, b = b, a % b
        return a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gcd(a, b):')
try:
    def egcd(a, b):
        if b == 0: return a, 1, 0
        g, x, y = egcd(b, a % b); return g, y, x - a // b * y
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def egcd(a, b):')
try: print('gcd(1071, 462) =>', gcd(1071, 462))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gcd(1071, 462)')
try: print('gcd(17, 5) =>', gcd(17, 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gcd(17, 5)')
try: print('gcd(0, 9) =>', gcd(0, 9))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gcd(0, 9)')
try: print('egcd(240, 46) =>', egcd(240, 46))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: egcd(240, 46)')
try: print('240 * egcd(240, 46)[1] + 46 * egcd(240, 46)[2] =>', 240 * egcd(240, 46)[1] + 46 * egcd(240, 46)[2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 240 * egcd(240, 46)[1] + 46 * egcd(240, 46)[2]')
try: print('12 * 18 // gcd(12, 18) =>', 12 * 18 // gcd(12, 18))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 12 * 18 // gcd(12, 18)')
try:
    def queens(n):
        sols = []
        def place(row, cols, d1, d2, cur):
            if row == n: sols.append(cur); return
            for c in range(n):
                if c not in cols and row - c not in d1 and row + c not in d2:
                    place(row + 1, cols | {c}, d1 | {row - c}, d2 | {row + c}, cur + [c])
        place(0, frozenset(), frozenset(), frozenset(), []); return sols
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def queens(n):')
try: print('[len(queens(n)) for n in range(1, 7)] =>', [len(queens(n)) for n in range(1, 7)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [len(queens(n)) for n in range(1, 7)]')
try: print('queens(6)[0] =>', queens(6)[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: queens(6)[0]')
try: print('queens(4) =>', queens(4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: queens(4)')
try:
    def knapsack(items, cap):
        best = [0] * (cap + 1)
        for w, v in items:
            for c in range(cap, w - 1, -1): best[c] = max(best[c], best[c - w] + v)
        return best[cap]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def knapsack(items, cap):')
try: print('knapsack([(12, 4), (2, 2), (1, 1), (1, 2), (4, 10)], 15) =>', knapsack([(12, 4), (2, 2), (1, 1), (1, 2), (4, 10)], 15))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: knapsack([(12, 4), (2, 2), (1, 1), (1, 2), (4, 10)], 15)')
try: print('knapsack([(w % 13 + 1, w % 29 + 1) for w in data[:30]], 60) =>', knapsack([(w % 13 + 1, w % 29 + 1) for w in data[:30]], 60))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: knapsack([(w % 13 + 1, w % 29 + 1) for w in data[:30]], 60)')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lcs(a, b):')
try:
    def edit(a, b):
        prev = list(range(len(b) + 1))
        for i, x in enumerate(a, 1):
            cur = [i]
            for j, y in enumerate(b, 1): cur.append(min(prev[j] + 1, cur[-1] + 1, prev[j - 1] + (x != y)))
            prev = cur
        return prev[-1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def edit(a, b):')
try: print('lcs("AGGTAB", "GXTXAYB") =>', lcs("AGGTAB", "GXTXAYB"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lcs("AGGTAB", "GXTXAYB")')
try: print('lcs("the quick brown fox", "a quick brown dog") =>', lcs("the quick brown fox", "a quick brown dog"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lcs("the quick brown fox", "a quick brown dog")')
try: print('edit("kitten", "sitting") =>', edit("kitten", "sitting"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: edit("kitten", "sitting")')
try: print('edit("", "abc") =>', edit("", "abc"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: edit("", "abc")')
try: print('edit("flaw", "lawn") =>', edit("flaw", "lawn"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: edit("flaw", "lawn")')
try: print('edit("intention", "execution") =>', edit("intention", "execution"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: edit("intention", "execution")')
try: graph = {"A": {"B": 7, "C": 9, "F": 14}, "B": {"A": 7, "C": 10, "D": 15}, "C": {"A": 9, "B": 10, "D": 11, "F": 2}, "D": {"B": 15, "C": 11, "E": 6}, "E": {"D": 6, "F": 9}, "F": {"A": 14, "C": 2, "E": 9}, "G": {}}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: graph = {"A": {"B": 7, "C": 9, "F": 14}, "B": {"A": 7, "C": 10, "D": ...')
try:
    def dijkstra(g, s):
        dist = {s: 0}; prev = {}; todo = [(0, s)]; done = set()
        while todo:
            todo.sort(reverse=True); d, u = todo.pop()
            if u in done: continue
            done.add(u)
            for v, w in g[u].items():
                if d + w < dist.get(v, float("inf")): dist[v] = d + w; prev[v] = u; todo.append((d + w, v))
        return dist, prev
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def dijkstra(g, s):')
try: dist, prev = dijkstra(graph, "A")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dist, prev = dijkstra(graph, "A")')
try: path = ["E"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: path = ["E"]')
try:
    while path[-1] in prev: path.append(prev[path[-1]])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while path[-1] in prev: path.append(prev[path[-1]])')
try: print('sorted(dist.items()) =>', sorted(dist.items()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(dist.items())')
try: print('path[::-1] =>', path[::-1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: path[::-1]')
try:
    def bfs(g, s):
        seen = [s]; q = [s]
        while q:
            u = q.pop(0)
            for v in sorted(g[u]):
                if v not in seen: seen.append(v); q.append(v)
        return seen
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bfs(g, s):')
try:
    def dfs(g, u, seen=None):
        seen = seen if seen is not None else []
        seen.append(u)
        for v in sorted(g[u]):
            if v not in seen: dfs(g, v, seen)
        return seen
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def dfs(g, u, seen=None):')
try: print('bfs(graph, "A") =>', bfs(graph, "A"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bfs(graph, "A")')
try: print('dfs(graph, "A") =>', dfs(graph, "A"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dfs(graph, "A")')
try: print('bfs(graph, "G") =>', bfs(graph, "G"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bfs(graph, "G")')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def toposort(deps):')
try: print(toposort({"shirt": ["tie", "belt"], "tie": ["jacket"], "trousers": ["shoes", "belt"], "belt": ["jacket"], "socks": ["shoes"], "jacket": [], "shoes": []}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: toposort({"shirt": ["tie", "belt"], "tie": ["jacket"], "trousers": ["...')
try:
    try: toposort({"a": ["b"], "b": ["c"], "c": ["a"], "d": []})
    except ValueError as e: print("ValueError:", e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: toposort({"a": ["b"], "b": ["c"], "c": ["a"], "d": []})')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class DSU:')
try: d = DSU(10)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = DSU(10)')
try: print('[d.union(a, b) for a, b in ((0, 1), (2, 3), (1, 3), (0, 2), (4, 5), (... =>', [d.union(a, b) for a, b in ((0, 1), (2, 3), (1, 3), (0, 2), (4, 5), (8, 9), (5, 9))])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [d.union(a, b) for a, b in ((0, 1), (2, 3), (1, 3), (0, 2), (4, 5), (...')
try: print('len({d.find(i) for i in range(10)}) =>', len({d.find(i) for i in range(10)}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len({d.find(i) for i in range(10)})')
try: print('sorted(d.size[d.find(i)] for i in range(10)) =>', sorted(d.size[d.find(i)] for i in range(10)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(d.size[d.find(i)] for i in range(10))')
try: edges = sorted((w, u, v) for u, vs in graph.items() for v, w in vs.items() if u < v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: edges = sorted((w, u, v) for u, vs in graph.items() for v, w in vs.it...')
try: idx = {k: i for i, k in enumerate(sorted(graph))}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: idx = {k: i for i, k in enumerate(sorted(graph))}')
try: d = DSU(len(idx))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = DSU(len(idx))')
try: mst = [(u, v, w) for w, u, v in edges if d.union(idx[u], idx[v])]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mst = [(u, v, w) for w, u, v in edges if d.union(idx[u], idx[v])]')
try: print('mst =>', mst)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mst')
try: print('sum(w for _, _, w in mst) =>', sum(w for _, _, w in mst))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(w for _, _, w in mst)')
try:
    def matmul(a, b): return [[sum(x * y for x, y in zip(r, c)) for c in zip(*b)] for r in a]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def matmul(a, b): return [[sum(x * y for x, y in zip(r, c)) for c in ...')
try:
    def matpow(m, n):
        r = [[int(i == j) for j in range(len(m))] for i in range(len(m))]
        while n:
            if n & 1: r = matmul(r, m)
            m = matmul(m, m); n >>= 1
        return r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def matpow(m, n):')
try:
    def transpose(m): return [list(r) for r in zip(*m)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def transpose(m): return [list(r) for r in zip(*m)]')
try:
    def det(m):
        if len(m) == 1: return m[0][0]
        return sum((-1) ** j * m[0][j] * det([r[:j] + r[j + 1:] for r in m[1:]]) for j in range(len(m)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def det(m):')
try: print('matmul([[1, 2], [3, 4]], [[5, 6], [7, 8]]) =>', matmul([[1, 2], [3, 4]], [[5, 6], [7, 8]]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: matmul([[1, 2], [3, 4]], [[5, 6], [7, 8]])')
try: print('matpow([[1, 1], [1, 0]], 90)[0][1] =>', matpow([[1, 1], [1, 0]], 90)[0][1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: matpow([[1, 1], [1, 0]], 90)[0][1]')
try: print('transpose([[1, 2, 3], [4, 5, 6]]) =>', transpose([[1, 2, 3], [4, 5, 6]]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: transpose([[1, 2, 3], [4, 5, 6]])')
try: print('det([[2, 0, 1], [1, 3, 2], [1, 1, 1]]) =>', det([[2, 0, 1], [1, 3, 2], [1, 1, 1]]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: det([[2, 0, 1], [1, 3, 2], [1, 1, 1]])')
try: print('det([[1, 2, 3, 4], [5, 6, 7, 8], [2, 6, 4, 8], [3, 1, 1, 2]]) =>', det([[1, 2, 3, 4], [5, 6, 7, 8], [2, 6, 4, 8], [3, 1, 1, 2]]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: det([[1, 2, 3, 4], [5, 6, 7, 8], [2, 6, 4, 8], [3, 1, 1, 2]])')
try:
    def to_base(n, b): return "0" if n == 0 else ("-" if n < 0 else "") + "".join("0123456789abcdefghijklmnopqrstuvwxyz"[d] for d in reversed([abs(n) // b ** i % b for i in range(len(bin(abs(n))))])).lstrip("0")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def to_base(n, b): return "0" if n == 0 else ("-" if n < 0 else "") +...')
try:
    def roman(n): return "".join(s * (n // v) + ("" if (n := n % v) is None else "") for v, s in ((1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def roman(n): return "".join(s * (n // v) + ("" if (n := n % v) is No...')
try: print('[to_base(255, b) for b in (2, 8, 16, 36)] =>', [to_base(255, b) for b in (2, 8, 16, 36)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [to_base(255, b) for b in (2, 8, 16, 36)]')
try: print('to_base(-10, 3) =>', to_base(-10, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: to_base(-10, 3)')
try: print('to_base(0, 2) =>', to_base(0, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: to_base(0, 2)')
try: print('int(to_base(123456789, 7), 7) =>', int(to_base(123456789, 7), 7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int(to_base(123456789, 7), 7)')
try:
    def roman2(n):
        out = ""
        for v, s in ((1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")):
            while n >= v: out += s; n -= v
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def roman2(n):')
try: print([roman2(n) for n in (1, 4, 9, 14, 40, 90, 400, 1994, 2024, 3999)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [roman2(n) for n in (1, 4, 9, 14, 40, 90, 400, 1994, 2024, 3999)]')
try:
    def perms(a):
        if len(a) <= 1: yield list(a); return
        for i in range(len(a)):
            for p in perms(a[:i] + a[i + 1:]): yield [a[i]] + p
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def perms(a):')
try:
    def combos(a, k):
        if k == 0: yield []; return
        for i in range(len(a) - k + 1):
            for c in combos(a[i + 1:], k - 1): yield [a[i]] + c
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def combos(a, k):')
try:
    def subsets(a): return [[x for i, x in enumerate(a) if m >> i & 1] for m in range(1 << len(a))]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def subsets(a): return [[x for i, x in enumerate(a) if m >> i & 1] fo...')
try: print('list(perms([1, 2, 3])) =>', list(perms([1, 2, 3])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(perms([1, 2, 3]))')
try: print('list(combos("abcd", 2)) =>', list(combos("abcd", 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(combos("abcd", 2))')
try: print('subsets([1, 2, 3]) =>', subsets([1, 2, 3]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: subsets([1, 2, 3])')
try: print('sum(1 for _ in perms(list(range(5)))) =>', sum(1 for _ in perms(list(range(5)))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(1 for _ in perms(list(range(5))))')
try: print('sum(1 for _ in combos(list(range(8)), 3)) =>', sum(1 for _ in combos(list(range(8)), 3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(1 for _ in combos(list(range(8)), 3))')
try:
    def coins(amount, kinds):
        ways = [1] + [0] * amount
        for k in kinds:
            for a in range(k, amount + 1): ways[a] += ways[a - k]
        return ways[amount]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def coins(amount, kinds):')
try:
    def lis(a):
        best = []
        for x in a:
            i = bsearch(best, x)
            if i == len(best): best.append(x)
            else: best[i] = x
        return len(best)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lis(a):')
try:
    def max_sub(a):
        best = cur = a[0]
        for x in a[1:]: cur = max(x, cur + x); best = max(best, cur)
        return best
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def max_sub(a):')
try: print('coins(100, [1, 5, 10, 25, 50]) =>', coins(100, [1, 5, 10, 25, 50]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: coins(100, [1, 5, 10, 25, 50])')
try: print('coins(200, [1, 2, 5, 10, 20, 50, 100, 200]) =>', coins(200, [1, 2, 5, 10, 20, 50, 100, 200]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: coins(200, [1, 2, 5, 10, 20, 50, 100, 200])')
try: print('lis(data) =>', lis(data))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lis(data)')
try: print('lis([10, 9, 2, 5, 3, 7, 101, 18]) =>', lis([10, 9, 2, 5, 3, 7, 101, 18]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lis([10, 9, 2, 5, 3, 7, 101, 18])')
try: print('max_sub([-2, 1, -3, 4, -1, 2, 1, -5, 4]) =>', max_sub([-2, 1, -3, 4, -1, 2, 1, -5, 4]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: max_sub([-2, 1, -3, 4, -1, 2, 1, -5, 4])')
try: print('max_sub([x - 500 for x in data]) =>', max_sub([x - 500 for x in data]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: max_sub([x - 500 for x in data])')
try:
    def pascal(n):
        row = [1]
        for _ in range(n): yield row; row = [a + b for a, b in zip([0] + row, row + [0])]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def pascal(n):')
try: print('list(pascal(7)) =>', list(pascal(7)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(pascal(7))')
try: print('max(list(pascal(40))[-1]) =>', max(list(pascal(40))[-1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: max(list(pascal(40))[-1])')
try:
    def collatz(n):
        steps = 0
        while n != 1: n = n // 2 if n % 2 == 0 else 3 * n + 1; steps += 1
        return steps
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def collatz(n):')
try: print('[collatz(n) for n in (1, 7, 27, 97, 871)] =>', [collatz(n) for n in (1, 7, 27, 97, 871)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [collatz(n) for n in (1, 7, 27, 97, 871)]')
try: print('max(range(1, 300), key=collatz) =>', max(range(1, 300), key=collatz))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: max(range(1, 300), key=collatz)')
try:
    def hanoi(n, a, b, c): return hanoi(n - 1, a, c, b) + [(a, c)] + hanoi(n - 1, b, a, c) if n else []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def hanoi(n, a, b, c): return hanoi(n - 1, a, c, b) + [(a, c)] + hano...')
try: print('len(hanoi(8, "A", "B", "C")) =>', len(hanoi(8, "A", "B", "C")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(hanoi(8, "A", "B", "C"))')
try: print('hanoi(3, "A", "B", "C") =>', hanoi(3, "A", "B", "C"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hanoi(3, "A", "B", "C")')
try:
    def spiral(m):
        out = []
        while m: out += m[0]; m = [list(r) for r in zip(*m[1:])][::-1]
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def spiral(m):')
try: print(spiral([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: spiral([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]])')
try:
    def flood(grid, r, c, new):
        grid = [list(row) for row in grid]; old = grid[r][c]; stack = [(r, c)]
        while stack:
            r, c = stack.pop()
            if 0 <= r < len(grid) and 0 <= c < len(grid[0]) and grid[r][c] == old != new:
                grid[r][c] = new; stack += [(r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)]
        return ["".join(row) for row in grid]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def flood(grid, r, c, new):')
try: print(flood(["..##.", ".#..#", "..#..", "##..."], 0, 0, "o"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: flood(["..##.", ".#..#", "..#..", "##..."], 0, 0, "o")')
