import _symtable

print(sorted((n, getattr(_symtable, n)) for n in dir(_symtable) if not n.startswith('__') and n != 'symtable'))

def dump(e, indent=0):
    print(' ' * indent + e.name, e.type, e.nested, e.lineno, e.varnames, sorted(e.symbols.items()))
    for c in e.children:
        dump(c, indent + 1)

def t(src, mode='exec'):
    print(repr(src))
    try:
        dump(_symtable.symtable(src, '<t>', mode))
    except SyntaxError as e:
        print(type(e).__name__, e.args, e.msg, e.filename, e.lineno, e.offset, e.end_lineno, e.end_offset, e.text)

for src in [
    '', 'x', 'x = 1', 'import a.b as c, d.e\nfrom f import g, h as i\nfrom j import *', 'global x\nx = 1', 'del x',
    'def f(a, /, b, *c, d=1, **e): return a + z', 'def f():\n  x = 1\n  def g():\n    return x\n  return g',
    'def f():\n  x = 1\n  def g():\n    nonlocal x\n    x = 2\n  def h():\n    global x\n    x = 3',
    'def f():\n  def g():\n    def h():\n      return x\n  x = 1',
    'class C:\n  x = 1\n  def m(self):\n    return __class__, x\n  def n(self):\n    super().n()',
    'class C(B, metaclass=M):\n  y = x\n  x = 1',
    'def f():\n  x = 1\n  class C:\n    x = x\n    def m(self): return x',
    'lambda a, b=c: a + d', '[x for x in y]', '[x for x in y if x for z in x]', '{x: y for x, y in z}', '{x for x in y}', '(x for x in y)',
    '[[a for a in b] for b in c]', '[lambda: x for x in y]', '[(lambda: x, z) for x in y]', 'def f():\n  return [lambda: x for x in y]', 'def f(y):\n  return [x + y for x in y]',
    'def f():\n  q = 1\n  return [[q for i in a] for j in b]', 'def f():\n  q = 1\n  return [[lambda: q for i in a] for j in b]', 'def f():\n  q = 1\n  return [(q for i in a) for j in b]',
    'class C:\n  z = [x for x in y]\n  w = [__class__ for _ in y]', 'class C:\n  a = 1\n  b = [a for _ in a]', 'x = 1\n[x for x in y]', 'def f():\n  x = 1\n  [x for x in y]\n  return x',
    'def f():\n  [y := x for x in z]\n  return y', '[y := x for x in z]', 'def f():\n  return [(y := x) for x in z if (w := x)]',
    'async def f():\n  return [x async for x in y]', 'async def f():\n  await x\n  async with a as b: pass\n  async for c in d: pass', 'def g():\n  yield 1\n  x = yield from y',
    'x: int = 1\ny: str', 'def f(a: int, b: "s" = 1) -> bool: pass', 'class C:\n  a: int\n  b: str = ""', 'def f():\n  x: int = 1\n  y: str',
    'from __future__ import annotations\nx: int = 1\ndef f(a: b) -> c: pass',
    'if c:\n  x: int = 1', 'class C:\n  if c:\n    x: int',
    'def f[T](a: T) -> T: pass', 'def f[T: int, *Ts, **P](a=1, *, b=2): pass', 'def f[T = int, U: (int, str) = str](): pass', 'class C[T](B[T]): x: T', 'class C[T: (a, b) = c]:\n  def m[U](self, x: T, y: U): pass',
    'type A = int', 'type A[T] = list[T]', 'type A[T: int = str, *Ts = x, **P = y] = z', 'class C:\n  type A[T] = T | x\n  x = 1', 'def f():\n  type A = x\n  x = 1',
    'class C:\n  def f[T](self): return __class__', 'class C[T]:\n  x = T\n  def m(self): return T',
    'try:\n  pass\nexcept E as e:\n  pass', 'with a as (b, c): pass', 'for i, j in k: pass', 'match x:\n  case [a, *b]: pass\n  case {"k": c, **d}: pass\n  case E(f, g=h) as i: pass\n  case j | k: pass',
    'class C:\n  __a = 1\n  def m(self): return self.__b, __c', 'class _C:\n  def m(__x): return __x', 'class C:\n  class D:\n    __x = 1',
    'def f():\n  import a.b\n  from c import d', 'def f(x):\n  del x', 'def f():\n  global a, b\n  a = b', 'x = 1\ndef f():\n  print(x)\n  def g():\n    print(x)',
    'def f(a, a): pass', 'def f():\n  x = 1\n  global x', 'def f():\n  nonlocal x', 'nonlocal x', 'def f(x):\n  global x', 'def f():\n  global x\n  nonlocal x', 'def f():\n  print(x)\n  global x',
    'def f():\n  x: int\n  global x', 'class C:\n  return 1', 'def f():\n  from a import *', '[x for x in (yield)]', '[(x := 1) for x in y]', 'class C:\n  [y := 1 for x in z]', 'x: (yield)', 'def f[T: (yield)](): pass',
    'def f[T, T](): pass', 'type A[T] = (x := 1)', 'def f(): await x', 'await x', 'lambda: (yield)', 'def f(__debug__): pass', '__debug__ = 1', 'f(a=1, a=2)', 'x = (yield)',
    'lazy import a', 'def f():\n  lazy import a', 'try:\n  lazy import a\nexcept E: pass', 'lazy from a import *',
    't"{x}{y!r:{z}}"', 'f"{x}{y!r:{z}}"', '@d(a)\ndef f(b=c): pass', '@d\nclass C(e): pass',
]:
    t(src)
t('x + y', 'eval')
t('lambda: x', 'eval')
t('x = 1', 'eval')
t('x = 1', 'single')
t(b'x = 1')
t(b'# coding: latin-1\n\xe9 = 1')
t('é = 1')

e = _symtable.symtable('def f(): pass', 'fn', 'exec')
print(type(e).__name__, type(e).__module__, type(e).__qualname__, repr(e).replace(str(e.id), 'ID'), type(e.id).__name__, e.children[0].id != e.id)
print(repr(e.children[0]).replace(str(e.children[0].id), 'ID'))
def err(f):
    try:
        print(f())
    except Exception as x:
        print(type(x).__name__, x)
err(lambda: type(e)())
err(lambda: setattr(e, 'name', 'x'))
err(lambda: e.foo)
err(lambda: _symtable.symtable('x', 'f', 'bad'))
err(lambda: _symtable.symtable('x', 'f'))
err(lambda: _symtable.symtable(1, 'f', 'exec'))
err(lambda: _symtable.symtable('x', 1, 'exec'))
err(lambda: _symtable.symtable('x', 'f', 1))
err(lambda: _symtable.symtable('x', b'f', 'exec').name)
err(lambda: _symtable.symtable('x', 'f', 'exec', module=1))
err(lambda: _symtable.symtable('x', 'f', 'exec', module='m').name)
err(lambda: _symtable.symtable('x', 'f', 'exec', None))
err(lambda: _symtable.symtable(source='x', filename='f', startstr='exec'))
err(lambda: _symtable.symtable('x\0', 'f', 'exec'))
err(lambda: _symtable.symtable('(', 'f', 'exec'))
err(lambda: sorted(n for n in dir(e) if not n.startswith('__')))
