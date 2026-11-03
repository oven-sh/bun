import array, sys
from array import array as A

def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)

def tn(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__)

a = A("i", range(10))
print(a[0], a[-1], a[9], a[-10], a[True])
t(lambda: a[10]); t(lambda: a[-11]); t(lambda: a["a"]); t(lambda: a[1.0]); t(lambda: a[None]); t(lambda: a[2 ** 70]); t(lambda: a[-2 ** 70]); t(lambda: a[(1, 2)])
for s in (slice(None), slice(2, 5), slice(-3, None), slice(None, -3), slice(5, 2), slice(None, None, 2), slice(1, None, 3), slice(None, None, -1), slice(8, 2, -2), slice(-1, -100, -3), slice(100, 200), slice(-200, -100), slice(2, 100, 4), slice(None, None, 100), slice(None, None, -100), slice(2 ** 70, None, -1), slice(-2 ** 70, 2 ** 70, 2 ** 70), slice(3, 3), slice(0, 0, -1)):
    print(s, a[s].tolist(), a[s].tolist() == list(range(10))[s], type(a[s]).__name__, a[s].typecode)
t(lambda: a[::0]); t(lambda: a["a":]); t(lambda: a[:1.5]); t(lambda: a[::"x"])
class I:
    def __index__(self): return 2
print(a[I()], a[I():], a[:I()], a[::I()])
def st(code):
    x = A("i", range(10)); l = list(range(10))
    env = {"x": x, "A": A, "I": I}
    try:
        exec(code, env)
        print(code, "->", x.tolist())
    except BaseException as e:
        print(code, "->", type(e).__name__, e, x.tolist())
for code in ("x[0] = 100", "x[-1] = 100", "x[10] = 1", "x[-11] = 1", "x['a'] = 1", "x[0] = 'a'", "x[0] = 2 ** 40", "x[1.0] = 1", "x[2 ** 70] = 1", "x[I()] = 77",
             "del x[0]", "del x[-1]", "del x[5]", "del x[10]", "del x[-11]", "del x['a']", "del x[I()]", "del x[2 ** 70]",
             "x[2:5] = A('i', [100])", "x[2:5] = A('i', [100, 101, 102])", "x[2:5] = A('i', range(100, 108))", "x[2:5] = A('i')", "x[5:2] = A('i', [100, 101])", "x[:] = A('i', [1])", "x[:] = A('i')", "x[10:] = A('i', [1, 2])", "x[100:] = A('i', [1, 2])", "x[:0] = A('i', [1, 2])", "x[-100:-50] = A('i', [1])", "x[3:3] = A('i', [7, 8])",
             "x[2:5] = x", "x[:] = x", "x[::2] = x[:5]", "x[::-1] = x", "x[5:] = x", "x[:0] = x",
             "x[2:5] = [1]", "x[2:5] = 5", "x[2:5] = None", "x[2:5] = A('h', [1])", "x[2:5] = A('I', [1])", "x[::2] = [1]", "x[::2] = A('h', range(5))",
             "x[::2] = A('i', range(100, 105))", "x[::2] = A('i', [1])", "x[::2] = A('i', range(6))", "x[::-1] = A('i', range(100, 110))", "x[1::3] = A('i', [7, 8, 9])", "x[8:2:-2] = A('i', [7, 8, 9])", "x[::2] = A('i')", "x[5:2:2] = A('i')", "x[5:2:2] = A('i', [1])", "x[::100] = A('i', [5])", "x[2:3:-1] = A('i')", "x[::-3] = A('i')",
             "del x[2:5]", "del x[:]", "del x[5:2]", "del x[::2]", "del x[1::2]", "del x[::-1]", "del x[::3]", "del x[::-3]", "del x[8:2:-2]", "del x[100:]", "del x[::100]", "del x[-1::-100]", "del x[2:9:4]", "del x[9:2:-4]", "del x[::0]", "del x[1:9:7]", "del x[:-1:2]",
             "x += A('i', [1])", "x += x", "x += [1]", "x += A('h', [1])", "x += 5", "x *= 2", "x *= 0", "x *= -1", "x *= 1", "x *= 'a'", "x *= 1.5", "x *= I()", "x *= 2 ** 62", "x *= 2 ** 70", "x *= True"):
    st(code)
for tc, vals in (("b", [1, 2, 3, 4, 5]), ("d", [1.5, 2.5, 3.5, 4.5, 5.5]), ("Zd", [1j, 2j, 3j, 4j, 5j]), ("w", "abcde"), ("e", [1, 2, 3, 4, 5]), ("Q", [2 ** 63, 1, 2, 3, 4])):
    x = A(tc, vals); y = x[1:4]; z = x[::-2]
    del x[1::2]; print(tc, x, y, z); x[1:1] = y; print(x); x[::2] = z; print(x, x * 2, x + y)
print(A("i", [1, 2]) + A("i", [3]), A("i") + A("i"), A("i", [1]) * 3, 3 * A("i", [1, 2]), A("i", [1]) * 0, A("i", [1]) * -5, A("i") * 5, A("i", [1]) * True, A("i", [1, 2]).__mul__(2), A("i", [1, 2]).__rmul__(2))
t(lambda: A("i", [1]) + A("h", [1])); t(lambda: A("i", [1]) + [1]); t(lambda: [1] + A("i", [1])); t(lambda: A("i", [1]) + None); t(lambda: A("i", [1]) * "a"); t(lambda: A("i", [1]) * 1.5); t(lambda: A("i", [1]) * 2 ** 62); t(lambda: A("i", [1]) * 2 ** 70); t(lambda: A("i", [1]) * 2 ** 45); t(lambda: "a" * A("i", [1])); t(lambda: A("i", [1]) * None); t(lambda: A("i", [1]) - A("i", [1]))
x = A("i", [1]); y = x; x += A("i", [2]); print(x is y, y); x *= 2; print(x is y, y)
class Evil:
    def __init__(self, x): self.x = x
    def __index__(self):
        self.x.clear()
        return 1
x = A("i", range(10)); t(lambda: x.__setitem__(5, Evil(x))); print(x)
x = A("i", range(10)); t(lambda: x[Evil(x)]); print(x)
x = A("i", range(10)); t(lambda: x[Evil(x):]); print(x)
x = A("i", range(10)); t(lambda: x[:Evil(x):-1]); print(x)
x = A("i", range(10)); t(lambda: x.__setitem__(slice(Evil(x), None), A("i", [5, 6]))); print(x)
x = A("i", range(10)); t(lambda: x.__delitem__(slice(None, None, Evil(x)))); print(x)
x = A("i", range(10)); t(lambda: x.append(Evil(x))); print(x)
x = A("i", range(10)); t(lambda: x.insert(5, Evil(x))); print(x)
x = A("i", range(10)); t(lambda: x.insert(Evil(x), 7)); print(x)
x = A("i", range(10)); t(lambda: x.pop(Evil(x))); print(x)
x = A("i", range(10)); t(lambda: x.extend([Evil(x), 5])); print(x)
class EvilEq:
    def __init__(self, x): self.x = x
    def __eq__(self, o):
        self.x.clear()
        return True
x = A("i", range(10)); t(lambda: x.remove(EvilEq(x))); print(x)
x = A("i", range(10)); t(lambda: x.index(EvilEq(x))); print(x)
x = A("i", range(10)); t(lambda: x.count(EvilEq(x))); print(x)
x = A("i", range(10)); t(lambda: EvilEq(x) in x); print(x)
big = sys.maxsize
for code in ("del x[::big]", "del x[3::big]", "del x[::-big]", "del x[5::-big]", "del x[0:big]", "del x[2:big:1]", "del x[2:big:3]", "del x[big:]", "del x[-big:3]", "x[1:big] = A('i', [7])", "x[::big] = A('i', [7])", "x[9::-big] = A('i', [7])", "x[big:big] = A('i', [7])", "x[-big:-big] = A('i', [7])", "x[::big] = A('i')", "x[4:big:big] = A('i', [7])"):
    st(code.replace("big", str(big)))
x = A("i", range(10)); print(x[::big], x[3::big], x[::-big], x[2:big], x[2:big:3], x[big:], x[-big:2], x[big::-1][:2], x[:-big:-4])
