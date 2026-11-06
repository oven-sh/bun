# Code that cannot be reached is of no line: CPython's compiler drops it. What co_lines(), co_positions() and co_branches() say of
# statements of all kinds behind a `return`, `raise`, `continue` or `break`, and under a test that is a constant.
try: import warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import warnings')
try: warnings.simplefilter('ignore', SyntaxWarning)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore', SyntaxWarning)")

try: DEAD = {
    'with': 'with a:\n    x = 1', 'with as': 'with a as b:\n    x = 1', 'with, two items': 'with a, b:\n    x = 1', 'with over lines': 'with (a,\n      b):\n    x = 1',
    'with that raises': 'with a:\n    raise', 'with that returns': 'with a:\n    return 1', 'with in with': 'with a:\n    with b:\n        x = 1',
    'async with': 'async with a:\n    x = 1', 'async with, two items': 'async with a, b:\n    x = 1', 'async for': 'async for x in a:\n    y = 1', 'await': 'await a',
    'try except': 'try:\n    x = 1\nexcept E:\n    x = 2', 'try finally': 'try:\n    x = 1\nfinally:\n    x = 2', 'try except*': 'try:\n    x = 1\nexcept* E:\n    x = 2',
    'try except as': 'try:\n    x = 1\nexcept E as e:\n    x = 2', 'try else': 'try:\n    x = 1\nexcept E:\n    x = 2\nelse:\n    x = 3',
    'for': 'for x in a:\n    y = 1', 'for else': 'for x in a:\n    y = 1\nelse:\n    y = 2', 'while': 'while a:\n    y = 1', 'if': 'if a:\n    x = 1\nelse:\n    x = 2',
    'match': 'match a:\n    case 1:\n        x = 1\n    case [b, {}]:\n        x = 2', 'assert': 'assert a, b', 'comprehension': 'x = [y for y in a\n     if y]', 'conditional': 'x = (a if b\n     else c)',
    'and': 'x = (a and\n     b)', 'def': 'def g():\n    return 1', 'class': 'class D:\n    x = 1', 'yield': 'yield a', 'raise': 'raise a',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: DEAD = { 'with': 'with a:\\n x = 1', 'with as': 'with a as b:\\n x = 1'...")
try:
    def indent(text, by=4):
        return '\n'.join(' ' * by + line for line in text.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def indent(text, by=4):')
try: BEHIND = {
    'return': lambda dead: 'return 0\n' + dead, 'raise': lambda dead: 'raise E\n' + dead,
    'continue': lambda dead: 'for i in z:\n    continue\n' + indent(dead), 'break': lambda dead: 'while z:\n    break\n' + indent(dead),
    'if False': lambda dead: 'if False:\n' + indent(dead), 'if 0, with else': lambda dead: 'if 0:\n' + indent(dead) + '\nelse:\n    w = 1', 'else of if 1': lambda dead: 'if 1:\n    w = 1\nelse:\n' + indent(dead),
    'while False': lambda dead: 'while False:\n' + indent(dead), 'while True': lambda dead: 'while True:\n    w = 1\n' + dead,
    'return in try': lambda dead: 'try:\n    return 0\n' + indent(dead) + '\nfinally:\n    w = 1', 'raise in with': lambda dead: 'with z:\n    raise E\n' + indent(dead),
    'if that returns both ways': lambda dead: 'if z:\n    return 0\nelse:\n    return 1\n' + dead,
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: BEHIND = { 'return': lambda dead: 'return 0\\n' + dead, 'raise': lambd...")
try: WHERE = {
    'function': 'def f():\n%s\n    return 9\n', 'generator': 'def f():\n    yield\n%s\n    return 9\n', 'coroutine': 'async def f():\n%s\n    return 9\n',
    'class': 'class f:\n%s\n    w = 9\n', 'module': None,
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: WHERE = { 'function': 'def f():\\n%s\\n return 9\\n', 'generator': 'def ...")

try:
    def find(code):
        for constant in code.co_consts:
            if hasattr(constant, 'co_code') and constant.co_name == 'f':
                return constant
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def find(code):')

try:
    for where, frame in WHERE.items():
        for behind, put in BEHIND.items():
            for name, dead in DEAD.items():
                try: text = put(dead)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: text = put(dead)')
                if frame:
                    try: text = frame % indent(text)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: text = frame % indent(text)')
                try:
                    code = compile(text if frame else text + '\nw = 9\n', 'd', 'exec')
                except SyntaxError as e:
                    continue
                if frame:
                    try: code = find(code)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: code = find(code)')
                try: line_at = {}
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: line_at = {}')
                for start, end, line in code.co_lines():
                    for offset in range(start, end):
                        try: line_at[offset] = line
                        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: line_at[offset] = line')
                try: lines = sorted({line for start, end, line in code.co_lines() if line is not None})
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lines = sorted({line for start, end, line in code.co_lines() if line ...')
                try: positions = sorted({p[0] for p in code.co_positions() if p[0] is not None})
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: positions = sorted({p[0] for p in code.co_positions() if p[0] is not ...')
                try: branches = sorted({(line_at[a], line_at[b], line_at[c]) for a, b, c in code.co_branches()}, key=repr)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: branches = sorted({(line_at[a], line_at[b], line_at[c]) for a, b, c i...')
                try: print("'%s | behind %s | %s | lines %s%s | branches %s' % (where, behind, na... [" + 'where=' + (repr(where) if type(where) in (str, int, float, bytes, bool, type(None)) or (type(where) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in where)) else where.__name__ if type(where) is type else type(where).__name__) + ", " + 'frame=' + (repr(frame) if type(frame) in (str, int, float, bytes, bool, type(None)) or (type(frame) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in frame)) else frame.__name__ if type(frame) is type else type(frame).__name__) + ", " + 'behind=' + (repr(behind) if type(behind) in (str, int, float, bytes, bool, type(None)) or (type(behind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in behind)) else behind.__name__ if type(behind) is type else type(behind).__name__) + ", " + 'put=' + (repr(put) if type(put) in (str, int, float, bytes, bool, type(None)) or (type(put) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in put)) else put.__name__ if type(put) is type else type(put).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'dead=' + (repr(dead) if type(dead) in (str, int, float, bytes, bool, type(None)) or (type(dead) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in dead)) else dead.__name__ if type(dead) is type else type(dead).__name__) + '] =>', '%s | behind %s | %s | lines %s%s | branches %s' % (where, behind, name, lines, '' if positions == lines else ' positions %s' % positions, branches))
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '%s | behind %s | %s | lines %s%s | branches %s' % (where, behind, na...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for where, frame in WHERE.items():')
