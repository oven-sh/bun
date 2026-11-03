import _ast as ast

def parse(s, mode='exec'):
    return compile(s, '<t>', mode, ast.PyCF_ONLY_AST)

for src in ['x', 'x + 1', 'f(a, b, c, d)', '[1, 2, 3]', '[1, 2]', '[1]', '[]', '()', '(1,)', '(1, 2, 3)', 'a.b.c.d.e.f', 'lambda: 0',
            '{1: 2}', 'x if y else z', '"s"', 'b"s"', '1.5', '2j', 'None', '...', 'f"{x!r:>{w}}"', 't"{x}"', '[i for i in y if i]', 'a < b < c', '-x', 'not x', 'x[1:2:3]']:
    print(repr(parse(src, 'eval')))
    print(repr(parse(src, 'eval').body))
for src in ['pass', 'def f(a, *b, c=1, **d) -> int: pass', 'class C(B, m=1): pass', 'import a.b as c, d', 'from . import x', 'lazy import q', 'x = y = 1', 'x: int = 1',
            'for i in y:\n pass\nelse:\n pass', 'try:\n pass\nexcept E as e:\n pass\nfinally:\n pass', 'with a as b, c: pass', 'match x:\n case [1, *r]: pass\n case {"k": v, **z}: pass\n case C(a, b=1) | None: pass',
            'type X[T: int = str, *Ts, **P] = T', 'global a, b', 'del a, b', 'raise E from c', 'assert a, b', 'async def f():\n await x\n async for i in y: pass\n async with z: pass', 'return', 'x += 1', '@d\ndef f(): pass']:
    try:
        tree = parse(src)
    except SyntaxError as e:
        print('SyntaxError', e)
        continue
    print(repr(tree))
    print(repr(tree.body[0]))
print(repr(ast.AST()))
print(repr(ast.Load()), repr(ast.Add()), str(ast.Pass()))
n = ast.Name('x')
n.id = n
print(repr(n))
l = ast.List([])
l.elts.append(l)
print(repr(l))
print(repr(ast.List(elts=(1, 2, 3))), repr(ast.List(elts=(ast.Load(),))), repr(ast.List(elts=())))
print(repr(ast.List(elts='abc')), repr(ast.List(elts={1: 2})))
n = ast.Name('x')
del n.ctx
try:
    print(repr(n))
except AttributeError as e:
    print('AttributeError', e)
class MyNode(ast.AST):
    _fields = ('a',)
print(repr(MyNode(1)), repr(MyNode(MyNode(MyNode(MyNode(MyNode(1)))))))
class L(list):
    pass
print(repr(ast.List(elts=L([1, 2, 3, 4]))))
