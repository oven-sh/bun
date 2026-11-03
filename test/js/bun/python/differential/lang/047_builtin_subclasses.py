def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

class I(int):
    def __repr__(s): return "I(%d)" % int(s)
    def double(s): return s * 2
i = I(5)
print(i, repr(i), str(i), int(i), i + 1, type(i + 1), i * i, type(i * i), -i, type(-i), abs(I(-3)), type(abs(I(-3))), i.double(), type(i.double()), i == 5, 5 == i, hash(i) == hash(5), {5: "a"}[i], {i: "b"}[5], i < 6, i in [5], [1, 2, 3, 4, 5, 6][i], list(range(i)), "ab" * I(2), i.bit_length(), i.real, type(i.real), type(i.numerator), type(+i), type(i.conjugate()), type(int(i)), type(i.__index__()), type(i.__int__()), type(round(i)), type(i & 1), type(i // 1), type(i ** 1), type(i << 0), type(~i), isinstance(i, int), type(i) is int, bool(I(0)), float(i), complex(i), divmod(i, 2), "%d %s %r %x" % (i, i, i, i), f"{i} {i!r} {i:d} {i:03}", format(i), format(i, "x"), bin(i), chr(I(65)), sum([i, i]), type(sum([i, i])), max(i, 3), type(max(i, 3)), sorted([I(2), 1, I(0)]), I("12"), I("ff", 16), I(3.9), I(), I(True), I(I(4)), type(I(I(4))))
i.attr = "x"; print(i.attr, i.__dict__, I(10 ** 30), I(10 ** 30) + 1, type(I(10 ** 30) * 2), I(2 ** 53) == 2 ** 53, I(-(10 ** 30)), hash(I(10 ** 30)) == hash(10 ** 30))
t(lambda: I("x")); t(lambda: I(1, 2)); t(lambda: I([])); t(lambda: I(None))
class F(float):
    def __repr__(s): return "F(%s)" % float.__repr__(s)
f = F(1.5)
print(f, str(f), float(f), f + 1, type(f + 1), f * 2, -f, type(-f), type(abs(f)), type(+f), f == 1.5, hash(f) == hash(1.5), {1.5: "a"}[f], f < 2, f.is_integer(), F(2.0).is_integer(), f.hex(), f.as_integer_ratio(), type(f.real), type(float(f)), type(f.conjugate()), int(f), round(f), type(round(f, 1)), "%s %r %f %.1f" % (f, f, f, f), f"{f} {f!r} {f:.2f}", format(f), format(f, "e"), F("2.5"), F(3), F(), F("inf"), F("nan") != F("nan"), F(2.0), F(2.0) == 2, type(F(2.0) + F(3.0)), isinstance(f, float), sum([f, f]), bool(F(0.0)), F(-0.0), F.fromhex("0x1p1"), type(F.fromhex("0x1p1")), F.from_number(1), type(F.from_number(1)), sorted([F(2.5), 1, F(0.5)]), complex(f), divmod(f, 1), f // 1, f % 1, f ** 2)
f.tag = 1; print(f.tag)
class S(str):
    def __repr__(s): return "S(%s)" % str.__repr__(s)
    def shout(s): return s.upper() + "!"
s = S("hello")
print(s, repr(s), str(s), type(str(s)), s + " w", type(s + " w"), s * 2, type(s * 2), s[0], type(s[0]), s[1:3], type(s[1:3]), s[:], type(s[:]), s.upper(), type(s.upper()), s.shout(), type(s.shout()), len(s), s == "hello", "hello" == s, hash(s) == hash("hello"), {"hello": 1}[s], {s: 2}["hello"], s < "z", "ell" in s, s in "hello world", list(s)[:2], s.split("l"), type(s.split("l")[0]), s.replace("x", "y"), type(s.replace("x", "y")), type(s.strip()), type(s.lower()), type(s.format()), type(s % ()), type(s.join([])), type(s.center(2)), type(s.ljust(1)), type(s.zfill(1)), type(s.expandtabs()), type(s.translate({})), type(s.removeprefix("x")), type(s.casefold()), type(s.encode()), s.startswith("he"), s.find("l"), s.count("l"), isinstance(s, str), "%s %r" % (s, s), f"{s} {s!r} {s!s} {s:>7}", format(s), format(s, "^9"), "-".join([s, s]), type("-".join([s])), type("".join([s])), "".join([s]) is s, sorted([S("b"), "a"]), S(5), S(b"a", "ascii"), S(), S(S("x")), type(S(S("x"))), bool(S("")), int(S("12")), float(S("1.5")), getattr(s, S("upper"))(), ord(S("a")), S("a") + S("b"), type(S("a") + S("b")), "x" + s, type("x" + s), s.__str__(), type(s.__str__()), iter(s).__next__(), type(iter(s).__next__()), max(s), reversed(s).__next__(), s.isidentifier(), S("é😀")[1], len(S("é😀")))
s.note = "n"; print(s.note, s.__dict__); d = {}; d[S("k")] = 1; d["k"] = 2; print(d, type(list(d)[0]).__name__); o = type("O", (), {})(); setattr(o, S("attr"), 1); print(o.attr, o.__dict__, type(list(o.__dict__)[0]).__name__, (lambda **k: k)(**{S("kw"): 1}), eval(S("1 + 1")), exec(S("pass")), compile(S("1"), S("f"), S("eval")).co_filename)
class StrEq(str):
    def __eq__(s, o): return True
    def __hash__(s): return 0
print(StrEq("a") == "b", "b" == StrEq("a"), {StrEq("a"): 1}.get("a"), {"a": 1}.get(StrEq("zz")), StrEq("a") in ["q"], "q" in [StrEq("a")])
class L(list):
    def __repr__(s): return "L" + list.__repr__(s)
    def first(s): return s[0]
l = L([1, 2, 3])
print(l, str(l), list(l), type(list(l)), l + [4], type(l + [4]), [0] + l, type([0] + l), l * 2, type(l * 2), l[0], l[1:], type(l[1:]), l[:], type(l[:]), l.copy(), type(l.copy()), l.first(), len(l), l == [1, 2, 3], [1, 2, 3] == l, l < [2], 2 in l, sorted(l, reverse=True), type(sorted(l)), list(reversed(l)), sum(l), isinstance(l, list), L(), L("ab"), L(range(2)), L(L([1])), bool(L()), [x for x in l], (*l,), [*l], "%s" % l, f"{l}", l.index(2), l.count(1), type(l.__add__([])), type(l.__mul__(1)), type(l.__rmul__(1)), max(l), tuple(l), set(l), dict.fromkeys(l), l.__class__.__name__, l != [1], l >= [1])
l.append(4); l.extend([5]); l.insert(0, 0); l += [6]; print(l, type(l)); l *= 1; print(type(l)); l[0] = 9; del l[0]; l[0:1] = [7, 8]; l.sort(); l.reverse(); print(l, l.pop(), l); l.name = "n"; print(l.name, l.__dict__); l.clear(); print(l, type(l))
t(lambda: hash(L())); t(lambda: L(1)); t(lambda: L(1, 2)); t(lambda: L([1])[5]); t(lambda: L() + (1,))
class LOver(list):
    def __getitem__(s, i): return "over"
    def __iter__(s): return iter(["iter"])
    def __len__(s): return 99
    def __contains__(s, v): return "always"
    def __eq__(s, o): return "eq"
    __hash__ = None
lo = LOver([1, 2]); print(lo[0], list(lo), len(lo), 5 in lo, lo == 1, [*lo], tuple(lo), list.__len__(lo), list.__getitem__(lo, 0), list.__iter__(lo).__next__(), repr(lo), lo + [3], lo * 2, lo.copy(), lo.index(2), sorted(lo), sum(list.__iter__(lo)), bool(lo), lo.pop(), [x for x in lo], max(lo), "".join(lo), dict.fromkeys(lo), set(lo), (lambda *a: a)(*lo), list(reversed(lo)), lo[:], [0, *lo])
a, = lo; print(a); x = []; x.extend(lo); print(x); x = [0]; x[0:1] = lo; print(x); x = []; x += lo; print(x)
class D(dict):
    def __repr__(s): return "D" + dict.__repr__(s)
d = D(a=1, b=2)
print(d, dict(d), type(dict(d)), d["a"], d.get("z"), len(d), "a" in d, list(d), d.copy(), type(d.copy()), d | {"c": 3}, type(d | {"c": 3}), {"c": 3} | d, type({"c": 3} | d), d == {"a": 1, "b": 2}, {"a": 1, "b": 2} == d, isinstance(d, dict), D(), D([("x", 1)]), D({"y": 2}, z=3), D.fromkeys("ab"), type(D.fromkeys("ab")), {**d}, (lambda **k: k)(**d), sorted(d.items()), bool(D()), d.keys(), d.values(), d.items(), type(d.keys()).__name__, "%(a)s" % d, "{a}".format(**d), "{a}".format_map(d), f"{d}", d.pop("a"), d, d.setdefault("q", 5), d.popitem(), d)
d.extra = 1; print(d.extra, d.__dict__, d); d |= {"n": 1}; print(d, type(d)); d.update(m=2); del d["n"]; d.clear(); print(d)
t(lambda: D()["zz"]); t(lambda: hash(D())); t(lambda: D(1)); t(lambda: D() < D())
class DOver(dict):
    def __getitem__(s, k): return "over " + str(k)
    def __setitem__(s, k, v): dict.__setitem__(s, k, ("set", v))
    def __contains__(s, k): return True
    def __iter__(s): return iter(["it"])
    def keys(s): return ["k1"]
    def __len__(s): return 7
    def get(s, k, d=None): return "get"
do = DOver(a=1); do["b"] = 2; do.update(c=3); do.setdefault("e", 5)
print(do["zz"], "zz" in do, list(do), len(do), do.get("a"), dict.__repr__(do), dict(do), {**do}, (lambda **k: k)(**do), dict.get(do, "a"), dict.__getitem__(do, "b"), do.copy(), sorted(dict.keys(do)), do.pop("a"), do == {}, dict.__len__(do), bool(do), [k for k in do], do.items(), "%(q)s" % do, "{q}".format_map(do), "{0[q]}".format(do), eval("zz", {}, do), do | {}, {} | do)
x = {}; x.update(do); print(x); print(dict(DOver(a=1), z=1))
class T(tuple):
    def __repr__(s): return "T" + tuple.__repr__(s)
tt = T([1, 2]); print(tt, tuple(tt), tt + (3,), type(tt + (3,)), tt * 2, type(tt[:1]), tt[0], len(tt), tt == (1, 2), hash(tt) == hash((1, 2)), {(1, 2): 1}[tt], "%s %s" % tt, "%s" % (tt,), isinstance(tt, tuple), T(), sorted(tt), [*tt], tt < (2,), tt.count(1), tt.index(2), type(tuple(tt)), bool(T()), (lambda *a: a)(*tt), max(tt), T("ab"), T(T([1])), type(tt.__add__(())), type(tt * 1), tt * 1 is tt, tt[:] is tt, type(tt[:]))
class St(set):
    def __repr__(s): return "St(%s)" % sorted(s)
st = St([1, 2]); print(st, st | {3}, type(st | {3}), {3} | st, type({3} | st), st & {1}, type(st & {1}), type(st - {1}), type(st ^ {1}), type(st.copy()), type(st.union([3])), type(st.intersection([1])), type(st.difference([1])), len(st), 1 in st, st == {1, 2}, isinstance(st, set), St(), sorted(st), bool(St()), st <= {1, 2, 3}, type(set(st))); st.add(3); st |= {4}; print(st, type(st)); st.x = 1; print(st.x)
class By(bytes):
    def __repr__(s): return "By(%s)" % bytes.__repr__(s)
by = By(b"ab"); print(by, bytes(by), type(bytes(by)), by + b"c", type(by + b"c"), by[0], by[:1], type(by[:1]), by.upper(), type(by.upper()), len(by), by == b"ab", hash(by) == hash(b"ab"), by.decode(), isinstance(by, bytes), By(), By(2), By([65]), By("é", "utf-8"), list(by), by * 2, type(by * 2), b"%s" % by, str(by), By.fromhex("41"), type(By.fromhex("41")), bool(By()))
class C(complex):
    def __repr__(s): return "C(%s)" % complex.__repr__(s)
c = C(1, 2); print(c, c + 1, type(c + 1), c.real, c.conjugate(), type(c.conjugate()), abs(C(3, 4)), c == 1 + 2j, hash(c) == hash(1 + 2j), complex(c), type(complex(c)), -c, type(-c), type(+c), C("1+1j"), C(), bool(C()), f"{c} {c:.1f}", isinstance(c, complex), c * c)
class B2(int):
    def __bool__(s): return False
    def __index__(s): return 99
    def __int__(s): return 98
    def __float__(s): return 97.0
    def __hash__(s): return 96
    def __eq__(s, o): return True
    def __str__(s): return "str!"
    def __format__(s, f): return "fmt!"
    def __add__(s, o): return "add!"
b2 = B2(1); print(bool(b2), [10, 20][b2], int(b2), float(b2), hash(b2), b2 == 500, str(b2), repr(b2), f"{b2}", "%s %d %r" % (b2, b2, b2), b2 + 1, 1 + b2, b2 - 1, b2 * 2, range(3)[b2], "ab"[b2], list(range(b2)), bin(b2), b2.__index__(), int.__index__(b2), "x" * b2, not b2, b2 and 1, {1: "one"}.get(b2), {96: "x"}.get(b2), complex(b2), round(b2), divmod(b2, 1), chr(B2(65)), pow(b2, 2), abs(b2), -b2, sum([b2, b2]), max(b2, 0), sorted([b2, 0]))
