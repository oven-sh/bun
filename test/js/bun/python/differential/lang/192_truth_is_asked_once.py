# No operand of and/or is asked for its truth twice (gh-124285), whatever the nesting.
import itertools
class V:
    def __init__(self, name, value):
        self.name, self.value, self.calls = name, value, 0
    def __bool__(self):
        self.calls += 1
        return self.value
    def __repr__(self):
        return self.name
EXPRESSIONS = [
    "a and b or c or d", "a or b and c or d", "(a or b) and (c or d)", "a and (b or c) and d", "(a and b) or (c and d)",
    "a or (b and (c or d))", "((a or b) and c) or d", "not (a and b) or c", "(a and b or c) and d", "a and b and c and d",
    "a or b or c or d", "(a or b or c) and d", "a and (b and c or d)", "(a if b else c) or d", "a or (b if c else d)",
    "[a and b or c][0] or d", "(a and b or c, d)[0]", "x if (a and b or c) else d",
]
for text in EXPRESSIONS:
    code = compile(text, "<e>", "eval")
    for values in itertools.product((False, True), repeat=4):
        names = {n: V(n, v) for n, v in zip("abcd", values)}
        names["x"] = "x"
        result = eval(code, names)
        print(text, "".join("FT"[v] for v in values), result, [names[n].calls for n in "abcd"])
# As a condition, in a comprehension, in a while loop
def f(a, b, c):
    out = []
    if a and b or c: out.append("if")
    out.append([1 for _ in range(1) if (a or b) and c])
    n = 0
    while (a and b or c) and n < 1: n += 1
    out.append(n)
    assert a or b or c or True
    return out
for values in itertools.product((False, True), repeat=3):
    vs = [V(n, v) for n, v in zip("abc", values)]
    print(f(*vs), [v.calls for v in vs])
# An exception in __bool__ is reported at the and/or it belongs to
class Bad:
    def __bool__(self): raise ValueError("no truth")
try:
    (Bad() and 1) or 2
except ValueError as e:
    tb = e.__traceback__
    print(tb.tb_lineno - 1 > 0, e)
