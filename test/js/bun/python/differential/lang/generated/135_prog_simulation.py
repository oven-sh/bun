# Simulations and grid programs.
try:
    class Rand:
        "A small deterministic generator (xorshift)."
        def __init__(self, seed): self.s = seed or 1
        def next(self):
            s = self.s; s ^= (s << 13) & 0xFFFFFFFF; s ^= s >> 17; s ^= (s << 5) & 0xFFFFFFFF; self.s = s; return s
        def below(self, n): return self.next() % n
        def uniform(self): return self.next() / 2 ** 32
        def choice(self, seq): return seq[self.below(len(seq))]
        def shuffle(self, a):
            for i in range(len(a) - 1, 0, -1): j = self.below(i + 1); a[i], a[j] = a[j], a[i]
            return a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Rand:')
try: r = Rand(2463534242)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = Rand(2463534242)')
try: print('[r.next() for _ in range(4)] =>', [r.next() for _ in range(4)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [r.next() for _ in range(4)]')
try: print('[r.below(10) for _ in range(12)] =>', [r.below(10) for _ in range(12)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [r.below(10) for _ in range(12)]')
try: print('round(r.uniform(), 6) =>', round(r.uniform(), 6))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: round(r.uniform(), 6)')
try: print('r.choice("abcdef") =>', r.choice("abcdef"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r.choice("abcdef")')
try: print('r.shuffle(list(range(10))) =>', r.shuffle(list(range(10))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r.shuffle(list(range(10)))')
try: hist = [0] * 6
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hist = [0] * 6')
try:
    for _ in range(1200): hist[r.below(6)] += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for _ in range(1200): hist[r.below(6)] += 1')
try: print('hist =>', hist)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hist')
try: print('sum(hist) =>', sum(hist))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(hist)')
# Conway's game of life.
try:
    def life(cells):
        counts = {}
        for x, y in cells:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if dx or dy: counts[x + dx, y + dy] = counts.get((x + dx, y + dy), 0) + 1
        return {c for c, n in counts.items() if n == 3 or (n == 2 and c in cells)}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def life(cells):')
try:
    def draw(cells, w, h): return "\n".join("".join("#" if (x, y) in cells else "." for x in range(w)) for y in range(h))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def draw(cells, w, h): return "\\n".join("".join("#" if (x, y) in cell...')
try: glider = {(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: glider = {(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)}')
try: g = glider
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = glider')
try:
    for gen in range(5):
        if gen in (0, 4): print(draw(g, 6, 6), "\n")
        try: g = life(g)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = life(g)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for gen in range(5):')
try: print('sorted(g) =>', sorted(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(g)')
try: print('{(x - 1, y - 1) for x, y in life(life(life(life(glider))))} == glider =>', {(x - 1, y - 1) for x, y in life(life(life(life(glider))))} == glider)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {(x - 1, y - 1) for x, y in life(life(life(life(glider))))} == glider')
try: blinker = {(1, 0), (1, 1), (1, 2)}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: blinker = {(1, 0), (1, 1), (1, 2)}')
try: print('sorted(life(blinker)) =>', sorted(life(blinker)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(life(blinker))')
try: print('life(life(blinker)) == blinker =>', life(life(blinker)) == blinker)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: life(life(blinker)) == blinker')
try: print('life({(0, 0), (1, 0), (0, 1), (1, 1)}) == {(0, 0), (1, 0), (0, 1), (1... =>', life({(0, 0), (1, 0), (0, 1), (1, 1)}) == {(0, 0), (1, 0), (0, 1), (1, 1)})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: life({(0, 0), (1, 0), (0, 1), (1, 1)}) == {(0, 0), (1, 0), (0, 1), (1...')
try: print('life({(0, 0)}) =>', life({(0, 0)}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: life({(0, 0)})')
try: print('life(set()) =>', life(set()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: life(set())')
try: rp = {(1, 0), (2, 0), (0, 1), (1, 1), (1, 2)}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: rp = {(1, 0), (2, 0), (0, 1), (1, 1), (1, 2)}')
try: pops = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pops = []')
try:
    for _ in range(30): pops.append(len(rp)); rp = life(rp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for _ in range(30): pops.append(len(rp)); rp = life(rp)')
try: print(pops)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pops')
# Elementary cellular automaton.
try:
    def rule(n, row): return [(n >> (row[i - 1] * 4 + row[i] * 2 + row[(i + 1) % len(row)])) & 1 for i in range(len(row))]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rule(n, row): return [(n >> (row[i - 1] * 4 + row[i] * 2 + row[(i...')
try: row = [0] * 15 + [1] + [0] * 15
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: row = [0] * 15 + [1] + [0] * 15')
try:
    for _ in range(8): print("".join(".#"[c] for c in row)); row = rule(90, row)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for _ in range(8): print("".join(".#"[c] for c in row)); row = rule(9...')
try: row = [0] * 15 + [1] + [0] * 15
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: row = [0] * 15 + [1] + [0] * 15')
try:
    for _ in range(6): row = rule(30, row)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for _ in range(6): row = rule(30, row)')
try: print('"".join(".#"[c] for c in row) =>', "".join(".#"[c] for c in row))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "".join(".#"[c] for c in row)')
try: print('sum(row) =>', sum(row))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(row)')
# Maze: generate with a depth-first carve, solve with breadth-first search.
try:
    def make_maze(w, h, rnd):
        grid = [["#"] * (2 * w + 1) for _ in range(2 * h + 1)]; stack = [(0, 0)]; seen = {(0, 0)}; grid[1][1] = " "
        while stack:
            x, y = stack[-1]; opts = [(x + dx, y + dy, dx, dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) if 0 <= x + dx < w and 0 <= y + dy < h and (x + dx, y + dy) not in seen]
            if not opts: stack.pop(); continue
            nx, ny, dx, dy = rnd.choice(opts); grid[2 * y + 1 + dy][2 * x + 1 + dx] = " "; grid[2 * ny + 1][2 * nx + 1] = " "; seen.add((nx, ny)); stack.append((nx, ny))
        return grid
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def make_maze(w, h, rnd):')
try:
    def solve(grid, start, goal):
        prev = {start: None}; q = [start]
        for cur in q:
            if cur == goal: break
            x, y = cur
            for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if grid[n[1]][n[0]] == " " and n not in prev: prev[n] = cur; q.append(n)
        path = []; cur = goal
        while cur: path.append(cur); cur = prev[cur]
        return path[::-1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def solve(grid, start, goal):')
try: mz = make_maze(8, 5, Rand(7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mz = make_maze(8, 5, Rand(7))')
try: path = solve(mz, (1, 1), (15, 9))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: path = solve(mz, (1, 1), (15, 9))')
try:
    for x, y in path: mz[y][x] = "o"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for x, y in path: mz[y][x] = "o"')
try: print("\n".join("".join(r) for r in mz))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "\\n".join("".join(r) for r in mz)')
try: print('len(path) =>', len(path))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(path)')
try: print('path[:4] =>', path[:4])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: path[:4]')
try: print('path[-1] =>', path[-1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: path[-1]')
# Mandelbrot in ASCII.
try:
    def mandel(w, h, it=30):
        out = []
        for j in range(h):
            line = ""
            for i in range(w):
                c = complex(-2.2 + 3.2 * i / w, -1.2 + 2.4 * j / h); z = 0j; n = 0
                while abs(z) <= 2 and n < it: z = z * z + c; n += 1
                line += " .:-=+*#%@"[n * 9 // it]
            out.append(line)
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def mandel(w, h, it=30):')
try: print("\n".join(mandel(48, 14)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "\\n".join(mandel(48, 14))')
# A queue simulation with discrete events.
try:
    def bank(customers, tellers, rnd):
        t = 0; arrivals = []
        for i in range(customers): t += 1 + rnd.below(4); arrivals.append((t, 2 + rnd.below(7)))
        free = [0] * tellers; waits = []
        for at, service in arrivals:
            k = min(range(tellers), key=lambda i: free[i]); start = max(at, free[k]); waits.append(start - at); free[k] = start + service
        return max(waits), sum(waits), round(sum(waits) / len(waits), 3), max(free)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bank(customers, tellers, rnd):')
try: print('bank(60, 1, Rand(99)) =>', bank(60, 1, Rand(99)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bank(60, 1, Rand(99))')
try: print('bank(60, 2, Rand(99)) =>', bank(60, 2, Rand(99)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bank(60, 2, Rand(99))')
try: print('bank(60, 3, Rand(99)) =>', bank(60, 3, Rand(99)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bank(60, 3, Rand(99))')
# Sudoku by backtracking (an easy grid).
try: PUZZLE = "530070000600195000098000060800060003400803001700020006060000280000419005000080079"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: PUZZLE = "53007000060019500009800006080006000340080300170002000606000...')
try:
    def sudoku(g):
        g = [int(c) for c in g]
        def ok(i, v):
            r, c = divmod(i, 9)
            return all(g[r * 9 + k] != v and g[k * 9 + c] != v for k in range(9)) and all(g[(r // 3 * 3 + a) * 9 + c // 3 * 3 + b] != v for a in range(3) for b in range(3))
        def options(i): return [v for v in range(1, 10) if ok(i, v)]
        def go():
            best = None
            for i in range(81):
                if g[i] == 0:
                    o = options(i)
                    if best is None or len(o) < len(best[1]): best = (i, o)
                    if len(o) <= 1: break
            if best is None: return True
            i, o = best
            for v in o:
                g[i] = v
                if go(): return True
            g[i] = 0; return False
        return "".join(map(str, g)) if go() else None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sudoku(g):')
try: sol = sudoku(PUZZLE)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sol = sudoku(PUZZLE)')
try: print("\n".join(" ".join(sol[r * 9:r * 9 + 9]) for r in range(9)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "\\n".join(" ".join(sol[r * 9:r * 9 + 9]) for r in range(9))')
try: print('all(sorted(sol[r * 9:r * 9 + 9]) == list("123456789") for r in range(9)) =>', all(sorted(sol[r * 9:r * 9 + 9]) == list("123456789") for r in range(9)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: all(sorted(sol[r * 9:r * 9 + 9]) == list("123456789") for r in range(9))')
try: print('all(sorted(sol[c::9]) == list("123456789") for c in range(9)) =>', all(sorted(sol[c::9]) == list("123456789") for c in range(9)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: all(sorted(sol[c::9]) == list("123456789") for c in range(9))')
# Tic-tac-toe with minimax.
try: LINES = [(0, 1, 2), (3, 4, 5), (6, 7, 8), (0, 3, 6), (1, 4, 7), (2, 5, 8), (0, 4, 8), (2, 4, 6)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LINES = [(0, 1, 2), (3, 4, 5), (6, 7, 8), (0, 3, 6), (1, 4, 7), (2, 5...')
try:
    def winner(b):
        for a, c, d in LINES:
            if b[a] != " " and b[a] == b[c] == b[d]: return b[a]
        return "draw" if " " not in b else None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def winner(b):')
try: memo = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: memo = {}')
try:
    def minimax(b, me):
        if (b, me) in memo: return memo[b, me]
        w = winner(b)
        if w: r = ({"X": 1, "O": -1, "draw": 0}[w], None)
        else:
            moves = [(minimax(b[:i] + me + b[i + 1:], "O" if me == "X" else "X")[0], i) for i in range(9) if b[i] == " "]
            r = max(moves, key=lambda m: (m[0], -m[1])) if me == "X" else min(moves, key=lambda m: (m[0], m[1]))
        memo[b, me] = r; return r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def minimax(b, me):')
try: b = "X O  O  X"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b = "X O O X"')
try: print('minimax(b, "X") =>', minimax(b, "X"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: minimax(b, "X")')
try: print('minimax("XX OO ", "X") =>', minimax("XX OO    ", "X"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: minimax("XX OO ", "X")')
try: print('minimax("XX OO ", "O") =>', minimax("XX OO    ", "O"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: minimax("XX OO ", "O")')
try: print('minimax("X O ", "X")[0] =>', minimax("X   O    ", "X")[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: minimax("X O ", "X")[0]')
try: print('len(memo) =>', len(memo))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(memo)')
# Bouncing ball physics with floats; a bank-interest table.
try: y, v, t, bounces = 10.0, 0.0, 0.0, []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: y, v, t, bounces = 10.0, 0.0, 0.0, []')
try:
    while len(bounces) < 4:
        try: v -= 9.81 * 0.01
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v -= 9.81 * 0.01')
        try: y += v * 0.01
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: y += v * 0.01')
        try: t += 0.01
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t += 0.01')
        if y <= 0: y = -y; v = -v * 0.8; bounces.append(round(t, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while len(bounces) < 4:')
try: print('bounces =>', bounces)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bounces')
try: print('round(y, 4) =>', round(y, 4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: round(y, 4)')
try: print('round(v, 4) =>', round(v, 4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: round(v, 4)')
try: bal = 1000.0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bal = 1000.0')
try:
    for year in range(1, 6): bal *= 1.035; print(f"{year:>2} {bal:>10.2f} {bal - 1000:>+9.2f} {'*' * int((bal - 1000) / 10)}")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for year in range(1, 6): bal *= 1.035; print(f"{year:>2} {bal:>10.2f}...')
# Random walk statistics and a Monte-Carlo estimate.
try: rw = Rand(12345)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: rw = Rand(12345)')
try: pos = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pos = 0')
try: far = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: far = 0')
try: visits = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: visits = {}')
try:
    for _ in range(2000): pos += 1 if rw.below(2) else -1; far = max(far, abs(pos)); visits[pos] = visits.get(pos, 0) + 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for _ in range(2000): pos += 1 if rw.below(2) else -1; far = max(far,...')
try: print('pos =>', pos)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pos')
try: print('far =>', far)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: far')
try: print('len(visits) =>', len(visits))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(visits)')
try: print('max(visits.items(), key=lambda kv: (kv[1], kv[0])) =>', max(visits.items(), key=lambda kv: (kv[1], kv[0])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: max(visits.items(), key=lambda kv: (kv[1], kv[0]))')
try: mc = Rand(777)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mc = Rand(777)')
try: inside = sum(1 for _ in range(3000) if mc.uniform() ** 2 + mc.uniform() ** 2 <= 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inside = sum(1 for _ in range(3000) if mc.uniform() ** 2 + mc.uniform...')
try: print('inside =>', inside)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inside')
try: print('round(4 * inside / 3000, 4) =>', round(4 * inside / 3000, 4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: round(4 * inside / 3000, 4)')
try: deck = [r_ + s for s in "SHDC" for r_ in "A23456789TJQK"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: deck = [r_ + s for s in "SHDC" for r_ in "A23456789TJQK"]')
try: Rand(5).shuffle(deck)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Rand(5).shuffle(deck)')
try: hands = [deck[i::4][:5] for i in range(4)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hands = [deck[i::4][:5] for i in range(4)]')
try: print('hands =>', hands)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hands')
try: print('len(set(deck)) =>', len(set(deck)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(set(deck))')
try:
    def score(h): return sum({"A": 11, "T": 10, "J": 10, "Q": 10, "K": 10}.get(c[0]) or int(c[0]) for c in h)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def score(h): return sum({"A": 11, "T": 10, "J": 10, "Q": 10, "K": 10...')
try: print('[score(h) for h in hands] =>', [score(h) for h in hands])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [score(h) for h in hands]')
try: print('max(hands, key=score) =>', max(hands, key=score))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: max(hands, key=score)')
