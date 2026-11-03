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

TC = ast.PyCF_TYPE_COMMENTS
for src in ['x = 1 # type: int', 'def f(a, # type: int\n      b=1, # type: str\n      *c, # type: bytes\n      **d # type: dict\n      ):\n  # type: (...) -> None\n  pass',
            'def f(a): # type: (int) -> int\n  pass', 'async def f(): # type: () -> int\n  pass', 'for i in x: # type: int\n  pass', 'async def g():\n  async for i in x: # type: int\n    pass\n  async with a as b: # type: T\n    pass',
            'with a as b: # type: T\n  pass', 'x = 1 # type: ignore', 'x = 1 # type: ignore[abc]\ny = 2 # type:ignore\n# type: ignore # why\nz = 3 #type: ignore@x', 'x = 1 # type:    spaced  ', 'x = [ # type: int\n 1]',
            'x = 1 # type: é', 'if x: # type: int\n  pass', 'x += 1 # type: int', 'x: int = 1 # type: int', 'def f(\n  a, # type: int\n): pass', 'lambda a: 0 # type: int', 'class C: # type: int\n  pass',
            'def f(*, a, # type: A\n  b # type: B\n): pass', 'def f(a, /, b # type: B\n): pass', '# type: int\nx = 1', 'x = 1 # type: int # more', 'x = y = 1 # type: int', 'def f(): pass # type: () -> None']:
    print(src.replace('\n', '\\n'))
    show(src)
    show(src, flags=TC)

for src in ['(int) -> str', '() -> None', '(int, str) -> bool', '(*int) -> x', '(**int) -> x', '(a, *b, **c) -> d', '(*a, **b) -> c', '(a, **b) -> c', 'int -> str', '(int)', '(a=1) -> b', '(...) -> int', '(a,) -> b', '(*a, b) -> c', '', '(List[int], Dict[str, int]) -> Tuple[()]', '(\n a,\n b\n) -> c']:
    print(repr(src))
    show(src, 'func_type')

for src, mode in [('x', 'eval'), ('x = 1', 'eval'), ('', 'eval'), ('x\n', 'eval'), ('\n\nx\n\n', 'eval'), (' x', 'eval'), ('x y', 'eval'), ('', 'exec'), ('\n', 'exec'), ('# c', 'exec'), ('', 'single'), ('\n', 'single'), ('x', 'single'),
                  ('x\n', 'single'), ('x;y', 'single'), ('x\ny', 'single'), ('if x:\n  y', 'single'), ('if x:\n  y\n', 'single'), ('if x:\n  y\n\n', 'single'), ('if x:\n  y\nz', 'single'), ('# c', 'single'), ('x # c', 'single'), ('def f(): pass', 'single')]:
    print(repr(src), mode)
    show(src, mode)
for flags in (0x200, 0x4000, 0x200 | 0x4000):
    for src in ['if x:\n  y', 'if x:', 'x = (', 'def f():\n  pass', 'x', 'if x:\n  y\n', 'x = \\', 'f(', '@d', 'class C:', 'try:\n  x', 'x +']:
        print(flags, repr(src))
        show(src, 'single', flags)
        show(src, 'exec', flags)

show(b'x = 1')
show(b'# -*- coding: latin-1 -*-\nx = "\xe9"')
show(b'\xef\xbb\xbfx = "\xc3\xa9"')
show(bytearray(b'x'))
show(memoryview(b'x'))
show('x = "\\N{DIGIT ONE}"')
show('x\0')
show(5)
show('x', 'bad')
show('x', 'exec', 0x10000000)
show('x', 'exec', optimize=3)
show('x', 'exec', module=5)
show('x', 'exec', module='m')
show('x', 'exec', dont_inherit=True)
