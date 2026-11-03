# Known gaps: the parser ignores _feature_version, and where an unfinished triple-quoted string is said to end.
import _ast as ast

def dump(node):
    if isinstance(node, ast.AST):
        return type(node).__name__ + '(' + ','.join(n + '=' + dump(getattr(node, n)) for n in node._fields + node._attributes) + ')'
    if isinstance(node, list):
        return '[' + ','.join(dump(x) for x in node) + ']'
    return repr(node)

def show(src, mode='exec', flags=0, **kw):
    try:
        print(dump(compile(src, '<t>', mode, ast.PyCF_ONLY_AST | flags, **kw)))
    except Exception as e:
        print(type(e).__name__, e, getattr(e, 'lineno', ''), getattr(e, 'offset', ''), getattr(e, 'end_lineno', ''), getattr(e, 'end_offset', ''), repr(getattr(e, 'text', '')))

features = ['x: int = 1', 'f"{x}"', '1_000', 'async def f(): await x', 'async = 1', 'await = 1', 'def f():\n  async = 1', 'async def f():\n  [x async for x in y]', 'def f(a, /): pass', '(x := 1)', 'f"{x=}"',
            'with (a as b, c as d): pass', 'with (a, b): pass', 'match x:\n  case 1: pass', 'try:\n  pass\nexcept* E:\n  pass', 'def f[T](): pass', 'class C[T]: pass', 'type X = int', 'def f[T = int](): pass',
            '@a.b[c]\ndef f(): pass', '@a()()\ndef f(): pass', 'a @ b', 'a @= b', 'print(*a, *b)', '{**a, **b}', 'x = *a, b', 'return *a, b', 'def f():\n  return *a, b', 'def f():\n  yield *a, b', 'for x in *a, b: pass',
            'x[*a]', 'def f(*a: *b): pass', 't"{x}"', 'try:\n  pass\nexcept A, B:\n  pass', 'lazy import a', '[*a for a in b]', '{**a for a in b}', 'lambda x, /: x', 'u"x"', 'rb"x"', 'x = yield', 'nonlocal x', 'global x',
            'with a as (b, c): pass', 'del (a), (b)', 'f(a for a in b)', 'async def f():\n  async with a: pass\n  async for b in c: pass', 'x = (yield)', 'print(f"{x!r:>{y}}")', 'f"{a["b"]}"', 'f"{\n x}"', "f'{x:{'a'}}'"]
for v in (-1, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 99):
    print('feature_version', v)
    for src in features:
        try:
            compile(src, '<t>', 'exec', ast.PyCF_ONLY_AST, _feature_version=v)
            print('  ok', repr(src))
        except SyntaxError as e:
            print('  ', repr(src), e.msg, e.lineno, e.offset, e.end_lineno, e.end_offset)
# It only counts with PyCF_ONLY_AST.
print(type(compile('(x := 1)', '<t>', 'exec', 0, _feature_version=5)).__name__)

for flags in (0x4000, 0x200 | 0x4000):
    show('x = """', 'single', flags)
    show('x = """', 'exec', flags)
