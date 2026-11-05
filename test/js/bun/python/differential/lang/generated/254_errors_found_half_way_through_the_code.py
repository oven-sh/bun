# Some errors are found only when the code is being made, half way through a function: there are jumps then that lead nowhere yet, handlers that have not
# been written, a generator that is not one yet. All that comes of it is the SyntaxError.
try: import itertools, textwrap, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import itertools, textwrap, warnings')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")

try: ERRORS = [
    'match x:\n    case [a] | [b]: pass',
    'match x:\n    case [a, a]: pass',
    'match x:\n    case _: pass\n    case 1: pass',
    'match x:\n    case y: pass\n    case 1: pass',
    "match x:\n    case {'k': 1, 'k': 2}: pass",
    'match x:\n    case [*a, *b]: pass',
    'match x:\n    case P(a=1, a=2): pass',
    'match x:\n    case (1 | y) | 2: pass',
    'a, *b, *c = x',
    'try:\n    pass\nexcept:\n    pass\nexcept E:\n    pass',
    '*a, = *b, *c = x',
    'class C:\n    return 1',
    'class C:\n    def g(self):\n        match x:\n            case [a] | [b]: pass',
    'def g():\n    match x:\n        case [a] | [b]: pass',
    'f = lambda: [(yield) for a in y]',
]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ERRORS = [ 'match x:\\n case [a] | [b]: pass', 'match x:\\n case [a, a]...")
try: CONTEXTS = [
    '{}',
    'def f(x):\n{}',
    'def f(x):\n    yield 1\n{}\n    yield 2',
    'async def f(x):\n    await x\n{}\n    await x',
    'async def f(x):\n    yield 1\n{}\n    yield 2',
    'def f(x):\n    if 0:\n        with x:\n{}',
    'def f(x):\n    while 0:\n        with x:\n{}',
    'def f(x):\n    while x:\n        try:\n            yield 1\n{}\n        finally:\n            yield 2',
    'def f(x):\n    for i in x:\n        with x, x:\n            if i:\n                break\n{}\n    else:\n        return 1',
    'def f(x):\n    try:\n        pass\n    except E as e:\n        for i in x:\n{}\n            continue',
    'async def f(x):\n    async with x:\n        async for i in x:\n{}',
    'def f(x):\n    return [i for i in x]\n{}',
    'class C:\n    for i in x:\n{}',
    'def f(x):\n    if x and 0:\n        for i in x:\n            try:\n{}\n            except* E:\n                pass',
]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: CONTEXTS = [ '{}', 'def f(x):\\n{}', 'def f(x):\\n yield 1\\n{}\\n yield ...")
try:
    def main():
        for context, error in itertools.product(CONTEXTS, ERRORS):
            before = context[:context.index('{}')].split('\n')
            depth = 0
            if len(before) > 1:
                last = before[-2]
                depth = len(last) - len(last.lstrip()) + (4 if last.rstrip().endswith(':') else 0)
            source = context.format(textwrap.indent(error, ' ' * depth))
            try:
                compile(source, '<source>', 'exec')
            except SyntaxError as e:
                print(type(e).__name__, e.msg, e.lineno, e.offset, e.end_lineno, e.end_offset)
            else:
                print('compiled')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def main():')
try: main()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: main()')
