try:
    def t(f):
        try:
            print(repr(f()))
        except BaseException as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lit(x):')
try:
    class IntSub(int): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class IntSub(int): pass')
try:
    class EqAny:
        def __eq__(s, o): return True
        __hash__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class EqAny:')
try:
    for v in (0, 1, -1, 1.5, -2.5, 1j, 1 + 2j, -1 - 2j, "a", "bc", b"x", None, True, False, 16, 1000, 1000.0, "triple", "\\d", "", 0.0, -0.0, 1.0, 0j, 2, "z", b"", [], (), IntSub(0), IntSub(1), bytearray(b"x"), EqAny(), float("nan"), ..., NotImplemented, object):
        try: print(repr(v) if not isinstance(v, EqAny) else "EqAny", "->", lit(v), end=" | ")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(repr(v) if not isinstance(v, EqAny) else "EqAny", "->", lit(v),...')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for v in (0, 1, -1, 1.5, -2.5, 1j, 1 + 2j, -1 - 2j, "a", "bc", b"x", ...')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
# True/False/None are matched by identity, numbers by equality.
try:
    def ident(x):
        match x:
            case True: return "is True"
            case False: return "is False"
            case None: return "is None"
            case 1: return "== 1"
            case 0: return "== 0"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ident(x):')
try: print([ident(v) for v in (True, False, None, 1, 0, 1.0, 0.0, EqAny(), IntSub(1), "")])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [ident(v) for v in (True, False, None, 1, 0, 1.0, 0.0, EqAny(), IntSu...')
try:
    def num_first(x):
        match x:
            case 1: return "== 1"
            case True: return "is True"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def num_first(x):')
try: print('num_first(True) =>', num_first(True))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: num_first(True)')
try: print('num_first(1) =>', num_first(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: num_first(1)')
try: print('num_first(1.0) =>', num_first(1.0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: num_first(1.0)')
# Captures and wildcards.
try:
    def cap(x):
        match x:
            case y: return ("captured", y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cap(x):')
try: print('cap(1) =>', cap(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cap(1)')
try: print('cap(None) =>', cap(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cap(None)')
try: print('cap([1]) =>', cap([1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cap([1])')
try:
    def wild(x):
        match x:
            case 1: return "one"
            case _: return "anything"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def wild(x):')
try: print('wild(1) =>', wild(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: wild(1)')
try: print('wild(2) =>', wild(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: wild(2)')
try: print('wild(None) =>', wild(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: wild(None)')
try:
    match 5:
        case n: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match 5:')
try: print(n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n')
try:
    match 6:
        case _: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match 6:')
try: print('_ =>', end=" "); t(lambda: _)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: _)')
try:
    def leak():
        match (1, 2):
            case (a, 3): return "no"
        return "a" in locals(), locals().get("a")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def leak():')
try: print(leak())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: leak()')
try:
    def leak2():
        match (1, 2):
            case (a, b) if b > 5: return "no"
            case (c, d): return sorted(locals().items())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def leak2():')
try: print(leak2())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: leak2()')
try:
    def unbound():
        match 1:
            case 2: z = 1
        return z
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def unbound():')
try: print('unbound() =>', end=" "); t(unbound)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(unbound)')
# Or patterns.
try:
    def orp(x):
        match x:
            case 1 | 2 | 3: return "small"
            case "a" | "b": return "letter"
            case None | False: return "falsy singleton"
            case (1, y) | (y, 1): return ("pair with 1", y)
            case [("x" | "y") as k, v] | [v, ("z" as k)]: return (k, v)
            case int() | float(): return "number"
            case _: return "other"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def orp(x):')
try: print([orp(v) for v in (1, 3, "b", None, False, (1, 5), (5, 1), (1, 1), ["x", 1], [2, "z"], 10, 2.5, "q", [])])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [orp(v) for v in (1, 3, "b", None, False, (1, 5), (5, 1), (1, 1), ["x...')
# As patterns.
try:
    def asp(x):
        match x:
            case (1 | 2) as n: return ("n", n)
            case [a, b] as whole: return (a, b, whole)
            case {"k": v} as m: return (v, m)
            case str() as s: return ("s", s)
            case (int() as i) | (float() as i): return ("num", i)
            case _ as anything: return ("any", anything)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def asp(x):')
try: print([asp(v) for v in (1, [3, 4], {"k": 5, "z": 6}, "str", 7, 8.5, None)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [asp(v) for v in (1, [3, 4], {"k": 5, "z": 6}, "str", 7, 8.5, None)]')
# Guards.
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def guard(x):')
try:
    for v in (-1, 0, 101, 102, 5):
        try: print(guard(v), end="; ")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(guard(v), end="; ")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for v in (-1, 0, 101, 102, 5):')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    def guard2(x):
        match x:
            case (a, b) if a == b: return "equal pair"
            case (a, b) if a > b: return "descending"
            case [*_] if len(x) > 3: return "long"
            case _ if isinstance(x, str): return "string"
            case _: return "fallthrough"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def guard2(x):')
try: print([guard2(v) for v in ((1, 1), (2, 1), (1, 2), [1, 2, 3, 4], "s", None)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [guard2(v) for v in ((1, 1), (2, 1), (1, 2), [1, 2, 3, 4], "s", None)]')
try:
    def guard_order(x):
        def g(n, r): print("guard", n, end="; "); return r
        match x:
            case 1 if g("a", False): return "a"
            case 2 if g("b", True): return "b"
            case 1 if g("c", True): return "c"
            case _ if g("d", True): return "d"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def guard_order(x):')
try: print(guard_order(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: guard_order(1)')
try: print(guard_order(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: guard_order(2)')
try: print(guard_order(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: guard_order(3)')
try:
    def guard_raises(x):
        match x:
            case n if 1 / n: return "ok"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def guard_raises(x):')
try: print('guard_raises(0) =>', end=" "); t(lambda: guard_raises(0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: guard_raises(0))')
try: print('guard_raises(1) =>', end=" "); t(lambda: guard_raises(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: guard_raises(1))')
try:
    def guard_values(x):
        match x:
            case _ if []: return "empty list is false"
            case _ if "": return "no"
            case _ if None: return "no"
            case _ if [0]: return "non-empty list is true"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def guard_values(x):')
try: print(guard_values(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: guard_values(1)')
try:
    def guard_walrus(x):
        match x:
            case n if (sq := n * n) > 10: return ("big", sq)
            case n: return ("small", sq)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def guard_walrus(x):')
try: print('guard_walrus(5) =>', guard_walrus(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: guard_walrus(5)')
try: print('guard_walrus(2) =>', guard_walrus(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: guard_walrus(2)')
# Value patterns (dotted names).
try:
    class Color:
        RED = 1; GREEN = 2
        class Nested: BLUE = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Color:')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try:
    class NS: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NS: pass')
try: ns = NS()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns = NS()')
try: ns.val = "v"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns.val = "v"')
try: ns.sub = NS()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns.sub = NS()')
try: ns.sub.deep = [1, 2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns.sub.deep = [1, 2]')
try:
    def val(x):
        match x:
            case Color.RED: return "red"
            case Color.GREEN: return "green"
            case Color.Nested.BLUE: return "blue"
            case ns.val: return "ns.val"
            case ns.sub.deep: return "deep list by equality"
            case sys.maxsize: return "maxsize"
            case _: return "other"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def val(x):')
try: print([val(v) for v in (1, 2, 3, "v", [1, 2], sys.maxsize, 1.0, True, 4)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [val(v) for v in (1, 2, 3, "v", [1, 2], sys.maxsize, 1.0, True, 4)]')
try:
    def val_missing(x):
        match x:
            case Color.PURPLE: return "?"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def val_missing(x):')
try: print('val_missing(1) =>', end=" "); t(lambda: val_missing(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: val_missing(1))')
try:
    def val_undefined(x):
        match x:
            case undefined_ns.attr: return "?"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def val_undefined(x):')
try: print('val_undefined(1) =>', end=" "); t(lambda: val_undefined(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: val_undefined(1))')
try:
    class Tr:
        def __eq__(s, o): print("__eq__ called with", o, end="; "); return True
        __hash__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Tr:')
try: ns.tr = Tr()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns.tr = Tr()')
try:
    def val_eq(x):
        match x:
            case ns.tr: return "matched through __eq__"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def val_eq(x):')
try: print(val_eq(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: val_eq(5)')
try:
    class SubjEq:
        def __eq__(s, o): print("subject.__eq__", o, end="; "); return o == 2
        __hash__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SubjEq:')
try:
    def subj(x):
        match x:
            case 1: return "one"
            case 2: return "two"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def subj(x):')
try: print(subj(SubjEq()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: subj(SubjEq())')
# The subject is evaluated once; cases in order; no fallthrough.
try:
    def once():
        def s(): print("subject evaluated", end="; "); return 3
        match s():
            case 1: return 1
            case 2: return 2
            case 3: return 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def once():')
try: print(once())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: once()')
try:
    def nofall(x):
        out = []
        match x:
            case 1: out.append("first")
            case 1: out.append("second")
            case _: out.append("default")
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nofall(x):')
try: print('nofall(1) =>', nofall(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nofall(1)')
try: print('nofall(2) =>', nofall(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nofall(2)')
try:
    def nomatch(x):
        match x:
            case 1: return "one"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nomatch(x):')
try: print(nomatch(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nomatch(2)')
# Subject forms.
try:
    match 1, 2:
        case (a, b): print("tuple subject", a, b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match 1, 2:')
try:
    match 1,:
        case (a,): print("one-tuple subject", a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match 1,:')
try:
    match (1, 2):
        case [a, b]: print("parens", a, b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match (1, 2):')
try:
    match [1, 2]:
        case a, b: print("open sequence pattern", a, b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match [1, 2]:')
try:
    match *[1, 2], 3:
        case [a, b, c]: print("starred subject", a, b, c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match *[1, 2], 3:')
try:
    match {"a": 1}:
        case {"a": v}: print("dict", v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match {"a": 1}:')
try:
    match (x := 5):
        case 5: print("walrus subject", x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match (x := 5):')
try:
    match lambda: 1:
        case f: print("lambda subject", f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match lambda: 1:')
try:
    match 1 if True else 2:
        case 1: print("conditional subject")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match 1 if True else 2:')
try:
    match not True:
        case False: print("not subject")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match not True:')
try:
    match -1:
        case -1: print("negative subject")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match -1:')
try:
    match "a" "b":
        case "ab": print("concatenated subject")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match "a" "b":')
try:
    match [x for x in range(2)]:
        case [0, 1]: print("comprehension subject")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match [x for x in range(2)]:')
try:
    match (yield_ := 1):
        case _: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match (yield_ := 1):')
# match, case, _ and type are soft keywords.
try: match = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match = 1')
try: case = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: case = 2')
try: print('match =>', match)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match')
try: print('case =>', case)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: case')
try: print('match + case =>', match + case)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match + case')
try: match = [1, 2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match = [1, 2]')
try: print('match[0] =>', match[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match[0]')
try: print('match[-1] =>', match[-1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match[-1]')
try: match[0] = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match[0] = 5')
try: print(match)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match')
try:
    def match(x): return ("function called match", x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def match(x): return ("function called match", x)')
try: print('match(1) =>', match(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match(1)')
try: print('match (2) =>', match (2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match (2)')
try: print('match((1, 2)) =>', match((1, 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match((1, 2))')
try:
    class case: attr = "class called case"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class case: attr = "class called case"')
try: print(case.attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: case.attr')
try: match = {"k": 1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match = {"k": 1}')
try: print(match["k"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match["k"]')
try: match.update(z=2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match.update(z=2)')
try: print(match)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match')
try: match = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match = 3')
try:
    match match:
        case 3: print("match match")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match match:')
try: case = 4
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: case = 4')
try:
    match case:
        case case: print("case case", case)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match case:')
try: match = lambda *a: a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match = lambda *a: a')
try: print('match(*[1, 2]) =>', match(*[1, 2]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match(*[1, 2])')
try: print('match(-1) =>', match(-1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match(-1)')
try: print('match - 1 if False else "" =>', match - 1 if False else "")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match - 1 if False else ""')
try: _ = "underscore is a normal name outside patterns"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: _ = "underscore is a normal name outside patterns"')
try: print(_)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: _')
try:
    match _:
        case str(): print("subject _")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match _:')
# Nested match, match in loops and functions.
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nested(x, y):')
try: print('nested(1, 1) =>', nested(1, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nested(1, 1)')
try: print('nested(1, 2) =>', nested(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nested(1, 2)')
try: print('nested(2, 1) =>', nested(2, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nested(2, 1)')
try: print('nested(2, 2) =>', nested(2, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nested(2, 2)')
try: out = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out = []')
try:
    for v in range(6):
        match v:
            case 0: continue
            case 4: break
            case 1 | 2: out.append("low")
            case _: out.append("mid")
    else: out.append("no break")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for v in range(6):')
try: print(out)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out')
try:
    def gen(xs):
        for x in xs:
            match x:
                case int(): yield x * 2
                case str(): yield x.upper()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen(xs):')
try: print(list(gen([1, "a", None, 2])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(gen([1, "a", None, 2]))')
try: print((lambda v: [v])(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (lambda v: [v])(1)')
