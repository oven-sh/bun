# How deep blocks may be nested: CPython's compiler has room for so many in one code object and refuses a program that has more.
# For each kind of block, with something in the innermost: the first depth that is refused, and where the one too many is said to be.
# (Not here: programs in which two statements are each one too many, behind a `return` that runs a `finally` clause.)
try: import warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import warnings')
try: warnings.simplefilter('ignore', SyntaxWarning)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore', SyntaxWarning)")

try: KINDS = {
    'for': ('for a in b:', None), 'while': ('while a:', None), 'with': ('with a:', None), 'with as': ('with a as b:', None), 'with two': ('with a, b:', None),
    'body of try finally': ('try:', 'finally:\n    pass'), 'body of try except': ('try:', 'except E:\n    pass'), 'body of try except*': ('try:', 'except* E:\n    pass'),
    'body of try except finally': ('try:', 'except E:\n    pass\nfinally:\n    pass'),
    'handler': ('try:\n    pass\nexcept E:', None), 'bare handler': ('try:\n    pass\nexcept:', None), 'named handler': ('try:\n    pass\nexcept E as e:', None),
    'handler of groups': ('try:\n    pass\nexcept* E:', None), 'named handler of groups': ('try:\n    pass\nexcept* E as e:', None),
    'handler, with finally': ('try:\n    pass\nexcept E:', 'finally:\n    pass'),
    'else of try': ('try:\n    pass\nexcept E:\n    pass\nelse:', None), 'else of for': ('for a in b:\n    pass\nelse:', None), 'else of while': ('while a:\n    pass\nelse:', None),
    'if': ('if a:', None), 'case': ('match a:\n  case 1:', None),
    'async for': ('async for a in b:', None), 'async with': ('async with a:', None), 'async with two': ('async with a, b:', None),
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: KINDS = { 'for': ('for a in b:', None), 'while': ('while a:', None), ...")
try: FOR = 'for a in b:\n    pass'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: FOR = 'for a in b:\\n pass'")
try:
    def indent(text, by=4):
        return '\n'.join(' ' * by + line for line in text.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def indent(text, by=4):')
try: INNER = {
    'pass': 'pass', 'return': 'return 1', 'break': 'break', 'continue': 'continue', 'assert': 'assert x, y', 'lambda': 'lambda: 0', 'yield': 'yield', 'yield from': 'yield from x', 'await': 'await x',
    'def with for': 'def g():\n' + indent(FOR), 'class with for': 'class D:\n' + indent(FOR), 'with in with': 'with c:\n    with d:\n        pass',
    'for in finally': 'try:\n    pass\nfinally:\n' + indent(FOR),
    'for in finally of return of a value': 'try:\n    return x\nfinally:\n' + indent(FOR),
    'for in finally of return of a sum': 'try:\n    return 1 + 1\nfinally:\n' + indent(FOR),
    'for in finally of return of a constant': 'try:\n    return 1\nfinally:\n' + indent(FOR),
    'for in finally of return': 'try:\n    return\nfinally:\n' + indent(FOR),
    'for in finally of break': 'try:\n    break\nfinally:\n' + indent(FOR),
    'for in finally of continue': 'try:\n    continue\nfinally:\n' + indent(FOR),
    'for in finally around return in finally of return': 'try:\n    try:\n        return x\n    finally:\n        return y\nfinally:\n' + indent(FOR),
    'for in finally around break in finally of return': 'try:\n    try:\n        return x\n    finally:\n        break\nfinally:\n' + indent(FOR),
    'for in finally of return in with': 'with c:\n    try:\n        return x\n    finally:\n' + indent(FOR, 8),
    'for in handler': 'try:\n    pass\nexcept E:\n' + indent(FOR), 'for in named handler': 'try:\n    pass\nexcept E as e:\n' + indent(FOR), 'for in handler of groups': 'try:\n    pass\nexcept* E:\n' + indent(FOR),
    'for in else of try': 'try:\n    pass\nexcept E:\n    pass\nelse:\n' + indent(FOR), 'for in case': 'match a:\n    case [1, 2]:\n' + indent(FOR, 8),
    'list comprehension': '[x for x in y]', 'dict comprehension': '{x: x for x in y}', 'generator expression': '(x for x in y)', 'two for clauses': '[x for x in y for z in x]',
    'comprehension in comprehension': '[[x for x in y] for y in z]', 'async comprehension': '[x async for x in y]', 'two async for clauses': '[x async for x in y async for z in x]',
    'async comprehension in comprehension': '[[x async for x in y] for y in z]', 'async comprehension in async comprehension': '[[x async for x in y] async for y in z]',
    'async generator expression': '(x async for x in y)',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: INNER = { 'pass': 'pass', 'return': 'return 1', 'break': 'break', 'co...")
try: WHERE = {
    'function': 'def f():\n%s', 'async function': 'async def f():\n%s', 'module': None, 'generator': 'def f():\n    yield\n%s', 'async generator': 'async def f():\n    yield\n%s',
    'class': 'class C:\n%s', 'method': 'class C:\n    def f(self):\n%s',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: WHERE = { 'function': 'def f():\\n%s', 'async function': 'async def f(...")
try: FEW = ('pass', 'list comprehension', 'for in finally')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: FEW = ('pass', 'list comprehension', 'for in finally')")

try:
    def nest(kind, depth, inner):
        head, tail = KINDS[kind]
        text = inner
        for i in range(depth):
            text = head + '\n' + indent(text) + ('\n' + tail if tail else '')
        return text
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nest(kind, depth, inner):')

try:
    def refusal(where, text):
        frame = WHERE[where]
        if frame:
            text = frame % indent(text, 8 if where == 'method' else 4)
        try:
            compile(text + '\n', 'n', 'exec')
        except SyntaxError as e:
            return e.msg, e.lineno, e.offset, e.end_lineno, e.end_offset
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def refusal(where, text):')

try:
    def rows():
        # Each kind of block; each thing in the innermost; each kind of code.
        for kind in KINDS:
            yield 'async function' if kind.startswith('async') else 'function', kind, 'pass'
        for name in INNER:
            yield 'async function' if 'async' in name or name == 'await' else 'function', 'for', name
        for where in WHERE:
            for name in FEW:
                yield where, 'with', name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rows():')

try:
    for where, kind, name in rows():
        # The least depth that is refused.
        try: allowed, refused = 0, 24
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: allowed, refused = 0, 24')
        if not refusal(where, nest(kind, refused, INNER[name])):
            try: print("'%s | %s | %s | any depth' % (where, kind, name) [" + 'where=' + (repr(where) if type(where) in (str, int, float, bytes, bool, type(None)) or (type(where) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in where)) else where.__name__ if type(where) is type else type(where).__name__) + ", " + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', '%s | %s | %s | any depth' % (where, kind, name))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '%s | %s | %s | any depth' % (where, kind, name)")
            continue
        while refused - allowed > 1:
            try: middle = (allowed + refused) // 2
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: middle = (allowed + refused) // 2')
            if refusal(where, nest(kind, middle, INNER[name])):
                try: refused = middle
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: refused = middle')
            else:
                try: allowed = middle
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: allowed = middle')
        try: print("'%s | %s | %s | %d: %r' % (where, kind, name, refused, refusal(where,... [" + 'where=' + (repr(where) if type(where) in (str, int, float, bytes, bool, type(None)) or (type(where) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in where)) else where.__name__ if type(where) is type else type(where).__name__) + ", " + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', '%s | %s | %s | %d: %r' % (where, kind, name, refused, refusal(where, nest(kind, refused, INNER[name]))))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '%s | %s | %s | %d: %r' % (where, kind, name, refused, refusal(where,...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for where, kind, name in rows():')

# The items of one `with` are blocks in blocks.
try:
    for count in (20, 21, 22, 23, 1000, 30000):
        try: print("'with, %d items | %r' % (count, refusal('function', 'with ' + ', '.jo... [" + 'count=' + (repr(count) if type(count) in (str, int, float, bytes, bool, type(None)) or (type(count) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in count)) else count.__name__ if type(count) is type else type(count).__name__) + '] =>', 'with, %d items | %r' % (count, refusal('function', 'with ' + ', '.join(['a'] * count) + ':\n    pass')))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'with, %d items | %r' % (count, refusal('function', 'with ' + ', '.jo...")
        try: print("'async with, %d items | %r' % (count, refusal('async function', 'asyn... [" + 'count=' + (repr(count) if type(count) in (str, int, float, bytes, bool, type(None)) or (type(count) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in count)) else count.__name__ if type(count) is type else type(count).__name__) + '] =>', 'async with, %d items | %r' % (count, refusal('async function', 'async with ' + ', '.join(['a'] * count) + ':\n    pass')))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'async with, %d items | %r' % (count, refusal('async function', 'asyn...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for count in (20, 21, 22, 23, 1000, 30000):')
