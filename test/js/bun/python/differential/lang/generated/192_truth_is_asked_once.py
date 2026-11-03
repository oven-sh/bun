# No operand of and/or is asked for its truth twice (gh-124285), whatever the nesting.
try: import itertools
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import itertools')
try:
    class V:
        def __init__(self, name, value):
            self.name, self.value, self.calls = name, value, 0
        def __bool__(self):
            self.calls += 1
            return self.value
        def __repr__(self):
            return self.name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class V:')
try: EXPRESSIONS = [
    "a and b or c or d", "a or b and c or d", "(a or b) and (c or d)", "a and (b or c) and d", "(a and b) or (c and d)",
    "a or (b and (c or d))", "((a or b) and c) or d", "not (a and b) or c", "(a and b or c) and d", "a and b and c and d",
    "a or b or c or d", "(a or b or c) and d", "a and (b and c or d)", "(a if b else c) or d", "a or (b if c else d)",
    "[a and b or c][0] or d", "(a and b or c, d)[0]", "x if (a and b or c) else d",
]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: EXPRESSIONS = [ "a and b or c or d", "a or b and c or d", "(a or b) a...')
try:
    for text in EXPRESSIONS:
        try: code = compile(text, "<e>", "eval")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: code = compile(text, "<e>", "eval")')
        for values in itertools.product((False, True), repeat=4):
            try: names = {n: V(n, v) for n, v in zip("abcd", values)}
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names = {n: V(n, v) for n, v in zip("abcd", values)}')
            try: names["x"] = "x"
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names["x"] = "x"')
            try: result = eval(code, names)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: result = eval(code, names)')
            try: print('text [' + 'text=' + (repr(text) if type(text) in (str, int, float, bytes, bool, type(None)) or (type(text) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in text)) else text.__name__ if type(text) is type else type(text).__name__) + ", " + 'values=' + (repr(values) if type(values) in (str, int, float, bytes, bool, type(None)) or (type(values) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in values)) else values.__name__ if type(values) is type else type(values).__name__) + '] =>', text)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: text')
            try: print('"".join("FT"[v] for v in values) [' + 'text=' + (repr(text) if type(text) in (str, int, float, bytes, bool, type(None)) or (type(text) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in text)) else text.__name__ if type(text) is type else type(text).__name__) + ", " + 'values=' + (repr(values) if type(values) in (str, int, float, bytes, bool, type(None)) or (type(values) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in values)) else values.__name__ if type(values) is type else type(values).__name__) + '] =>', "".join("FT"[v] for v in values))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "".join("FT"[v] for v in values)')
            try: print('result [' + 'text=' + (repr(text) if type(text) in (str, int, float, bytes, bool, type(None)) or (type(text) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in text)) else text.__name__ if type(text) is type else type(text).__name__) + ", " + 'values=' + (repr(values) if type(values) in (str, int, float, bytes, bool, type(None)) or (type(values) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in values)) else values.__name__ if type(values) is type else type(values).__name__) + '] =>', result)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: result')
            try: print('[names[n].calls for n in "abcd"] [' + 'text=' + (repr(text) if type(text) in (str, int, float, bytes, bool, type(None)) or (type(text) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in text)) else text.__name__ if type(text) is type else type(text).__name__) + ", " + 'values=' + (repr(values) if type(values) in (str, int, float, bytes, bool, type(None)) or (type(values) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in values)) else values.__name__ if type(values) is type else type(values).__name__) + '] =>', [names[n].calls for n in "abcd"])
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [names[n].calls for n in "abcd"]')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for text in EXPRESSIONS:')
# As a condition, in a comprehension, in a while loop
try:
    def f(a, b, c):
        out = []
        if a and b or c: out.append("if")
        out.append([1 for _ in range(1) if (a or b) and c])
        n = 0
        while (a and b or c) and n < 1: n += 1
        out.append(n)
        assert a or b or c or True
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f(a, b, c):')
try:
    for values in itertools.product((False, True), repeat=3):
        try: vs = [V(n, v) for n, v in zip("abc", values)]
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vs = [V(n, v) for n, v in zip("abc", values)]')
        try: print('f(*vs) [' + 'values=' + (repr(values) if type(values) in (str, int, float, bytes, bool, type(None)) or (type(values) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in values)) else values.__name__ if type(values) is type else type(values).__name__) + '] =>', f(*vs))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f(*vs)')
        try: print('[v.calls for v in vs] [' + 'values=' + (repr(values) if type(values) in (str, int, float, bytes, bool, type(None)) or (type(values) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in values)) else values.__name__ if type(values) is type else type(values).__name__) + '] =>', [v.calls for v in vs])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [v.calls for v in vs]')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for values in itertools.product((False, True), repeat=3):')
# An exception in __bool__ is reported at the and/or it belongs to
try:
    class Bad:
        def __bool__(self): raise ValueError("no truth")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Bad:')
try:
    try:
        (Bad() and 1) or 2
    except ValueError as e:
        tb = e.__traceback__
        print('tb.tb_lineno - 1 > 0 =>', tb.tb_lineno - 1 > 0)
        print('e =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
