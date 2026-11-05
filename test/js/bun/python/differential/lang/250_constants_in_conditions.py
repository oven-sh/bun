# A constant somewhere in a condition may rule out one of the ways the condition can go: `if a and 0:`, `while a or 1:` with an `else`. CPython's
# compiler drops what cannot be reached then, so the code has no such lines. What the code does is the same either way.
import itertools, warnings
warnings.simplefilter('ignore')
CONDS = ['a and 0', 'a or 1', 'a and 1', 'a or 0', '0 and a', '1 or a', 'not (a or 1)', 'not (a and 0)', 'a and b and 0', 'a or b or 1', '(a or b) and 0', '(a and b) or 1',
         'a and (b or 1)', 'a or (b and 0)', 'a and None', 'a or "x"', 'a and ()', 'a and (0 or 0)', 'a and not 1', '(a and 0) or b', '(a or 1) and b', '(a and 0) and b', '(a or 1) or b',
         '(a, 0) and 0', 'a and 0 and b', 'a or 1 or b', 'a and __debug__', 'a and not __debug__', 'a and ... ', 'a and 0.0', "a and ''", "a and b''", 'a and -1', 'a and 1 - 1']
FORMS = {
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
for (kind, form), condition in itertools.product(FORMS.items(), CONDS):
    namespace = {}
    exec(compile(form.format(c=condition), '<shape>', 'exec'), namespace)
    f = namespace['f']
    results = []
    if not kind.startswith('while'):  # (They may never end.)
        for a, b in itertools.product((0, 1, [], [0]), repeat=2):
            try:
                results.append(f(a, b))
            except Exception as e:
                results.append(type(e).__name__)
    print(kind, '|', condition, '|', sorted({line for _, _, line in f.__code__.co_lines() if line}), results)
