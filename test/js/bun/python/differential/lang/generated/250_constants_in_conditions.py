# A constant somewhere in a condition may rule out one of the ways the condition can go: `if a and 0:`, `while a or 1:` with an `else`. CPython's
# compiler drops what cannot be reached then, so the code has no such lines. What the code does is the same either way.
try: import itertools, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import itertools, warnings')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")
try: CONDS = ['a and 0', 'a or 1', 'a and 1', 'a or 0', '0 and a', '1 or a', 'not (a or 1)', 'not (a and 0)', 'a and b and 0', 'a or b or 1', '(a or b) and 0', '(a and b) or 1',
         'a and (b or 1)', 'a or (b and 0)', 'a and None', 'a or "x"', 'a and ()', 'a and (0 or 0)', 'a and not 1', '(a and 0) or b', '(a or 1) and b', '(a and 0) and b', '(a or 1) or b',
         '(a, 0) and 0', 'a and 0 and b', 'a or 1 or b', 'a and __debug__', 'a and not __debug__', 'a and ... ', 'a and 0.0', "a and ''", "a and b''", 'a and -1', 'a and 1 - 1']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: CONDS = ['a and 0', 'a or 1', 'a and 1', 'a or 0', '0 and a', '1 or a...")
try: FORMS = {
'if': 'def f(a, b):\n    x = 0\n    if {c}:\n        x = 1\n    return x\n',
'if else': 'def f(a, b):\n    if {c}:\n        x = 1\n    else:\n        x = 2\n    return x\n',
'while': 'def f(a, b):\n    while {c}:\n        x = 1\n    return 2\n',
'while else': 'def f(a, b):\n    while {c}:\n        x = 1\n    else:\n        x = 3\n    return 2\n',
'loop with break': 'def f(a, b):\n    x = 0\n    while {c}:\n        x = 1\n        break\n    return x\n',
'loop with break and else': 'def f(a, b):\n    x = 0\n    while {c}:\n        x = 1\n        break\n    else:\n        x = 3\n    return x\n',
'loop with return': 'def f(a, b):\n    while {c}:\n        return 1\n    return 2\n',
'ifexp': 'def f(a, b):\n    return (1\n        if {c} else\n        2)\n',
'ifexp in an expression': 'def f(a, b):\n    return [(1\n        if {c} else\n        2),\n        3]\n',
'ifexp as a condition': 'def f(a, b):\n    if (a\n        if {c} else\n        b):\n        return 1\n    return 2\n',
'assert': 'def f(a, b):\n    assert {c}, (\n        b)\n    return 2\n',
'elif': 'def f(a, b):\n    if b:\n        x = 0\n    elif {c}:\n        x = 1\n    else:\n        x = 2\n    return x\n',
'comp': 'def f(a, b):\n    return [x\n        for x in (1, 2)\n        if {c}]\n',
'if last': 'def f(a, b):\n    if {c}:\n        return 1\n',
'if not': 'def f(a, b):\n    x = 0\n    if not ({c}):\n        x = 1\n    return x\n',
'in a loop': 'def f(a, b):\n    x = 0\n    for i in (1, 2):\n        if {c}:\n            continue\n        x += i\n    return x\n',
'in a loop, last': 'def f(a, b):\n    x = 0\n    for i in (1, 2):\n        x += 1\n        if {c}:\n            x += i\n    return x\n',
'over lines': 'def f(a, b):\n    x = 0\n    if (b or\n        ({c}) or\n        b):\n        x = 1\n    return x\n',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: FORMS = { 'if': 'def f(a, b):\\n x = 0\\n if {c}:\\n x = 1\\n return x\\n'...")
try:
    for (kind, form), condition in itertools.product(FORMS.items(), CONDS):
        try: namespace = {}
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: namespace = {}')
        try: exec(compile(form.format(c=condition), '<shape>', 'exec'), namespace)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec(compile(form.format(c=condition), '<shape>', 'exec'), namespace)")
        try: f = namespace['f']
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: f = namespace['f']")
        try: results = []
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: results = []')
        if not kind.startswith('while'):  # (They may never end.)
            for a, b in itertools.product((0, 1, [], [0]), repeat=2):
                try:
                    results.append(f(a, b))
                except Exception as e:
                    results.append(type(e).__name__)
        try: print('kind [' + 'condition=' + (repr(condition) if type(condition) in (str, int, float, bytes, bool, type(None)) or (type(condition) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in condition)) else condition.__name__ if type(condition) is type else type(condition).__name__) + ", " + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + ", " + 'form=' + (repr(form) if type(form) in (str, int, float, bytes, bool, type(None)) or (type(form) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in form)) else form.__name__ if type(form) is type else type(form).__name__) + '] =>', kind)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kind')
        try: print('|', 'condition [' + 'condition=' + (repr(condition) if type(condition) in (str, int, float, bytes, bool, type(None)) or (type(condition) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in condition)) else condition.__name__ if type(condition) is type else type(condition).__name__) + ", " + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + ", " + 'form=' + (repr(form) if type(form) in (str, int, float, bytes, bool, type(None)) or (type(form) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in form)) else form.__name__ if type(form) is type else type(form).__name__) + '] =>', condition)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: condition')
        try: print('|', 'sorted({line for _, _, line in f.__code__.co_lines() if line}) [' + 'condition=' + (repr(condition) if type(condition) in (str, int, float, bytes, bool, type(None)) or (type(condition) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in condition)) else condition.__name__ if type(condition) is type else type(condition).__name__) + ", " + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + ", " + 'form=' + (repr(form) if type(form) in (str, int, float, bytes, bool, type(None)) or (type(form) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in form)) else form.__name__ if type(form) is type else type(form).__name__) + '] =>', sorted({line for _, _, line in f.__code__.co_lines() if line}))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted({line for _, _, line in f.__code__.co_lines() if line})')
        try: print('results [' + 'condition=' + (repr(condition) if type(condition) in (str, int, float, bytes, bool, type(None)) or (type(condition) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in condition)) else condition.__name__ if type(condition) is type else type(condition).__name__) + ", " + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + ", " + 'form=' + (repr(form) if type(form) in (str, int, float, bytes, bool, type(None)) or (type(form) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in form)) else form.__name__ if type(form) is type else type(form).__name__) + '] =>', results)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: results')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for (kind, form), condition in itertools.product(FORMS.items(), CONDS):')
