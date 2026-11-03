def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

def lit(x):
    match x:
        case 0: return "zero"
        case 1: return "one"
        case -1: return "minus one"
        case 1.5: return "float"
        case -2.5: return "negative float"
        case 1j: return "imaginary"
        case 1 + 2j: return "complex"
        case -1 - 2j: return "negative complex"
        case "a": return "str a"
        case "b" "c": return "concatenated"
        case b"x": return "bytes"
        case None: return "None"
        case True: return "True"
        case False: return "False"
        case 0x10: return "hex"
        case 1_000: return "underscore"
        case 1e3 if False: return "guard false"
        case """triple""": return "triple quoted"
        case r"\d": return "raw"
        case "": return "empty str"
    return "no match"
class IntSub(int): pass
class EqAny:
    def __eq__(s, o): return True
    __hash__ = None
for v in (0, 1, -1, 1.5, -2.5, 1j, 1 + 2j, -1 - 2j, "a", "bc", b"x", None, True, False, 16, 1000, 1000.0, "triple", "\\d", "", 0.0, -0.0, 1.0, 0j, 2, "z", b"", [], (), IntSub(0), IntSub(1), bytearray(b"x"), EqAny(), float("nan"), ..., NotImplemented, object):
    print(repr(v) if not isinstance(v, EqAny) else "EqAny", "->", lit(v), end=" | ")
print()
# True/False/None are matched by identity, numbers by equality.
def ident(x):
    match x:
        case True: return "is True"
        case False: return "is False"
        case None: return "is None"
        case 1: return "== 1"
        case 0: return "== 0"
print([ident(v) for v in (True, False, None, 1, 0, 1.0, 0.0, EqAny(), IntSub(1), "")])
def num_first(x):
    match x:
        case 1: return "== 1"
        case True: return "is True"
print(num_first(True), num_first(1), num_first(1.0))
# Captures and wildcards.
def cap(x):
    match x:
        case y: return ("captured", y)
print(cap(1), cap(None), cap([1]))
def wild(x):
    match x:
        case 1: return "one"
        case _: return "anything"
print(wild(1), wild(2), wild(None))
match 5:
    case n: pass
print(n)
match 6:
    case _: pass
t(lambda: _)
def leak():
    match (1, 2):
        case (a, 3): return "no"
    return "a" in locals(), locals().get("a")
print(leak())
def leak2():
    match (1, 2):
        case (a, b) if b > 5: return "no"
        case (c, d): return sorted(locals().items())
print(leak2())
def unbound():
    match 1:
        case 2: z = 1
    return z
t(unbound)
# Or patterns.
def orp(x):
    match x:
        case 1 | 2 | 3: return "small"
        case "a" | "b": return "letter"
        case None | False: return "falsy singleton"
        case (1, y) | (y, 1): return ("pair with 1", y)
        case [("x" | "y") as k, v] | [v, ("z" as k)]: return (k, v)
        case int() | float(): return "number"
        case _: return "other"
print([orp(v) for v in (1, 3, "b", None, False, (1, 5), (5, 1), (1, 1), ["x", 1], [2, "z"], 10, 2.5, "q", [])])
# As patterns.
def asp(x):
    match x:
        case (1 | 2) as n: return ("n", n)
        case [a, b] as whole: return (a, b, whole)
        case {"k": v} as m: return (v, m)
        case str() as s: return ("s", s)
        case (int() as i) | (float() as i): return ("num", i)
        case _ as anything: return ("any", anything)
print([asp(v) for v in (1, [3, 4], {"k": 5, "z": 6}, "str", 7, 8.5, None)])
# Guards.
def guard(x):
    match x:
        case n if n < 0: return "negative"
        case n if n == 0: return "zero"
        case n if n > 100 and n % 2: return "big odd"
        case (a, b) if a == b: return "equal pair"
        case (a, b) if a > b: return "descending"
        case [*_] if len(x) > 3: return "long"
        case _ if isinstance(x, str): return "string"
        case _: return "fallthrough"
for v in (-1, 0, 101, 102, 5):
    print(guard(v), end="; ")
print()
def guard2(x):
    match x:
        case (a, b) if a == b: return "equal pair"
        case (a, b) if a > b: return "descending"
        case [*_] if len(x) > 3: return "long"
        case _ if isinstance(x, str): return "string"
        case _: return "fallthrough"
print([guard2(v) for v in ((1, 1), (2, 1), (1, 2), [1, 2, 3, 4], "s", None)])
def guard_order(x):
    def g(n, r): print("guard", n, end="; "); return r
    match x:
        case 1 if g("a", False): return "a"
        case 2 if g("b", True): return "b"
        case 1 if g("c", True): return "c"
        case _ if g("d", True): return "d"
print(guard_order(1)); print(guard_order(2)); print(guard_order(3))
def guard_raises(x):
    match x:
        case n if 1 / n: return "ok"
t(lambda: guard_raises(0)); t(lambda: guard_raises(1))
def guard_values(x):
    match x:
        case _ if []: return "empty list is false"
        case _ if "": return "no"
        case _ if None: return "no"
        case _ if [0]: return "non-empty list is true"
print(guard_values(1))
def guard_walrus(x):
    match x:
        case n if (sq := n * n) > 10: return ("big", sq)
        case n: return ("small", sq)
print(guard_walrus(5), guard_walrus(2))
# Value patterns (dotted names).
class Color:
    RED = 1; GREEN = 2
    class Nested: BLUE = 3
import sys
class NS: pass
ns = NS(); ns.val = "v"; ns.sub = NS(); ns.sub.deep = [1, 2]
def val(x):
    match x:
        case Color.RED: return "red"
        case Color.GREEN: return "green"
        case Color.Nested.BLUE: return "blue"
        case ns.val: return "ns.val"
        case ns.sub.deep: return "deep list by equality"
        case sys.maxsize: return "maxsize"
        case _: return "other"
print([val(v) for v in (1, 2, 3, "v", [1, 2], sys.maxsize, 1.0, True, 4)])
def val_missing(x):
    match x:
        case Color.PURPLE: return "?"
t(lambda: val_missing(1))
def val_undefined(x):
    match x:
        case undefined_ns.attr: return "?"
t(lambda: val_undefined(1))
class Tr:
    def __eq__(s, o): print("__eq__ called with", o, end="; "); return True
    __hash__ = None
ns.tr = Tr()
def val_eq(x):
    match x:
        case ns.tr: return "matched through __eq__"
print(val_eq(5))
class SubjEq:
    def __eq__(s, o): print("subject.__eq__", o, end="; "); return o == 2
    __hash__ = None
def subj(x):
    match x:
        case 1: return "one"
        case 2: return "two"
print(subj(SubjEq()))
# The subject is evaluated once; cases in order; no fallthrough.
def once():
    def s(): print("subject evaluated", end="; "); return 3
    match s():
        case 1: return 1
        case 2: return 2
        case 3: return 3
print(once())
def nofall(x):
    out = []
    match x:
        case 1: out.append("first")
        case 1: out.append("second")
        case _: out.append("default")
    return out
print(nofall(1), nofall(2))
def nomatch(x):
    match x:
        case 1: return "one"
print(nomatch(2))
# Subject forms.
match 1, 2:
    case (a, b): print("tuple subject", a, b)
match 1,:
    case (a,): print("one-tuple subject", a)
match (1, 2):
    case [a, b]: print("parens", a, b)
match [1, 2]:
    case a, b: print("open sequence pattern", a, b)
match *[1, 2], 3:
    case [a, b, c]: print("starred subject", a, b, c)
match {"a": 1}:
    case {"a": v}: print("dict", v)
match (x := 5):
    case 5: print("walrus subject", x)
match lambda: 1:
    case f: print("lambda subject", f())
match 1 if True else 2:
    case 1: print("conditional subject")
match not True:
    case False: print("not subject")
match -1:
    case -1: print("negative subject")
match "a" "b":
    case "ab": print("concatenated subject")
match [x for x in range(2)]:
    case [0, 1]: print("comprehension subject")
match (yield_ := 1):
    case _: pass
# match, case, _ and type are soft keywords.
match = 1; case = 2; print(match, case, match + case)
match = [1, 2]; print(match[0], match[-1]); match[0] = 5; print(match)
def match(x): return ("function called match", x)
print(match(1), match (2), match((1, 2)))
class case: attr = "class called case"
print(case.attr)
match = {"k": 1}; print(match["k"]); match.update(z=2); print(match)
match = 3
match match:
    case 3: print("match match")
case = 4
match case:
    case case: print("case case", case)
match = lambda *a: a
print(match(*[1, 2]), match(-1), match - 1 if False else "")
_ = "underscore is a normal name outside patterns"; print(_)
match _:
    case str(): print("subject _")
# Nested match, match in loops and functions.
def nested(x, y):
    match x:
        case 1:
            match y:
                case 1: return "1,1"
                case _: return "1,other"
        case _:
            match y:
                case 1: return "other,1"
    return "other,other"
print(nested(1, 1), nested(1, 2), nested(2, 1), nested(2, 2))
out = []
for v in range(6):
    match v:
        case 0: continue
        case 4: break
        case 1 | 2: out.append("low")
        case _: out.append("mid")
else: out.append("no break")
print(out)
def gen(xs):
    for x in xs:
        match x:
            case int(): yield x * 2
            case str(): yield x.upper()
print(list(gen([1, "a", None, 2])))
print((lambda v: [v])(1))
