# Stores of young objects into old ones, by the instructions the interpreter does itself.
import gc
N = 2000
old = [None] * N
def make_cell():
    c = None
    def put(v):
        nonlocal c
        c = v
    def get(): return c
    return put, get
cells = [make_cell() for _ in range(200)]
G0 = G1 = G2 = None
gc.collect(); gc.collect()

def garbage(k):
    x = []
    for i in range(k):
        x.append((i, str(i), [i]))
    return len(x)

def fill(round):
    global G0, G1, G2
    for i in range(N):
        old[i] = (round, i, str(i * round))
        if i % 97 == 0: garbage(300)
    for j in range(len(cells)):
        cells[j][0]([round, j, "c%d" % j])
        if j % 13 == 0: garbage(300)
    G0 = [round, "g0"]; garbage(2000)
    G1 = (round, "g1" + str(round)); garbage(2000)
    G2 = {"r": round}; garbage(2000)

def check(round):
    for i in range(N):
        v = old[i]
        assert v == (round, i, str(i * round)), (i, v)
    for j in range(len(cells)):
        assert cells[j][1]() == [round, j, "c%d" % j], j
    assert G0 == [round, "g0"] and G1 == (round, "g1" + str(round)) and G2 == {"r": round}

for round in range(1, 13):
    fill(round)
    garbage(20000)
    check(round)
    if round % 4 == 0: gc.collect()
print("ok")
