# An __index__ that changes the list while a subscript is being worked out.
def case(f):
    try: print(f())
    except Exception as e: print(type(e).__name__, e)
def make(n=10): return list(range(n))
class X:
    def __init__(self, l, v, action): self.l, self.v, self.action = l, v, action
    def __index__(self):
        self.action(self.l)
        return self.v
clear = lambda l: l.clear()
grow = lambda l: l.extend(range(100, 120))
shrink = lambda l: l.__delitem__(slice(3, None))
for action in (clear, grow, shrink):
    for v in (0, 1, 2, 5, 9, -1, -5, 15, 25, -25, 10**30, -10**30):
        def g1(): l = make(); return l[X(l, v, action)], l
        def g2(): l = make(); l[X(l, v, action)] = 'x'; return l
        def g3(): l = make(); del l[X(l, v, action)]; return l
        def g4(): l = make(); return l[X(l, v, action):], l
        def g5(): l = make(); return l[:X(l, v, action)], l
        def g6(): l = make(); return l[::X(l, v, action)], l
        def g7(): l = make(); l[X(l, v, action):] = 'ab'; return l
        def g8(): l = make(); l[:X(l, v, action)] = 'ab'; return l
        def g9(): l = make(); l[0:10:X(l, v, action)] = []; return l
        def g10(): l = make(); l[0:10:X(l, v, action)] = 'abcde'; return l
        def g11(): l = make(); del l[X(l, v, action):]; return l
        def g12(): l = make(); del l[:X(l, v, action)]; return l
        def g13(): l = make(); del l[::X(l, v, action)]; return l
        def g14(): l = make(); del l[1:X(l, v, action):2]; return l
        def g15(): l = make(); l[X(l, 1, action):X(l, v, action):X(l, 2, action)] = 'ab'; return l
        for g in (g1, g2, g3, g4, g5, g6, g7, g8, g9, g10, g11, g12, g13, g14, g15): case(g)
order = []
class O:
    def __init__(self, n, v): self.n, self.v = n, v
    def __index__(self): order.append(self.n); return self.v
print(make()[O('start', 1):O('stop', 8):O('step', 2)], order)
case(lambda: make()['a':])
case(lambda: make()[1.5])
case(lambda: make()[:1.5])
class B(int): pass
print(make()[B(2)], make()[B(2):B(5)], make()[True], make()[10**30:], make()[:-10**30], make()[::10**30])
case(lambda: make()[10**30])
class H:
    def __index__(self): return 10**30
case(lambda: make()[H()])
