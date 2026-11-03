import _ast as ast
import sys

def t(f):
    try:
        r = f()
        print(sorted(vars(r).items(), key=lambda kv: kv[0]) if isinstance(r, ast.AST) else '', repr(r))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

t(lambda: ast.Name('x'))
t(lambda: ast.Name('x', ast.Store()))
t(lambda: ast.Name(id='x'))
t(lambda: ast.Name('x', ctx=ast.Del()))
t(lambda: ast.Name())
t(lambda: ast.Name('x', ast.Load(), 3))
t(lambda: ast.Name('x', id='y'))
t(lambda: ast.Name('x', foo=1))
t(lambda: ast.Name('x', lineno=3, col_offset=4))
t(lambda: ast.Name('x', lineno=3, end_lineno=None))
t(lambda: ast.BinOp())
t(lambda: ast.BinOp(1))
t(lambda: ast.BinOp(1, 2))
t(lambda: ast.BinOp(1, 2, 3))
t(lambda: ast.BinOp(left=1, right=2))
t(lambda: ast.Module())
t(lambda: ast.Module([]))
t(lambda: ast.Module([], []))
t(lambda: ast.Module([], [], []))
t(lambda: ast.FunctionDef('f', ast.arguments()))
t(lambda: ast.FunctionDef())
t(lambda: ast.arguments())
t(lambda: ast.arg())
t(lambda: ast.arg('a'))
t(lambda: ast.Constant())
t(lambda: ast.Constant(None))
t(lambda: ast.Constant(1, 'u'))
t(lambda: ast.Load())
t(lambda: ast.Load(1))
t(lambda: ast.Add(x=1))
t(lambda: ast.Pass())
t(lambda: ast.Pass(lineno=1))
t(lambda: ast.Return())
t(lambda: ast.Import())
t(lambda: ast.ImportFrom())
t(lambda: ast.Dict())
t(lambda: ast.Interpolation())
t(lambda: ast.MatchAs())
t(lambda: ast.TypeVar())
t(lambda: ast.TypeIgnore())
t(lambda: ast.comprehension())
t(lambda: ast.AnnAssign())
t(lambda: ast.Attribute(ast.Name('a'), 'b'))

print(ast.Name('x').ctx is ast.Name('y').ctx)
print(type(ast.Name('x').ctx).__name__)
print(ast.Load() is ast.Load())
a = ast.Module()
b = ast.Module()
print(a.body is b.body, a.body == b.body)
print(ast.Return().value, 'value' in vars(ast.Return()))
print(ast.Name('x').end_lineno, hasattr(ast.Name('x'), 'lineno'))

# Abstract classes
import warnings
for cls in (ast.AST, ast.mod, ast.stmt, ast.expr, ast.expr_context, ast.operator, ast.pattern, ast.type_param, ast.excepthandler):
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter('always')
        node = cls()
        print(cls.__name__, repr(node), [(x.category.__name__, str(x.message)) for x in w])
    print(ast._is_abstract(cls))
for cls in (ast.Name, ast.arguments, ast.Load, int, 3):
    print(ast._is_abstract(cls))
t(lambda: ast._is_abstract([]))

# Subclasses
class MyName(ast.Name):
    pass
t(lambda: MyName('x'))
t(lambda: MyName())
class Custom(ast.AST):
    _fields = ('a', 'b')
t(lambda: Custom())
t(lambda: Custom(1))
t(lambda: Custom(1, 2))
t(lambda: Custom(1, 2, 3))
t(lambda: Custom(a=1, c=2))
class Typed(ast.AST):
    _fields = ('a', 'b', 'c', 'd')
    _field_types = {'a': int, 'b': list[int], 'c': int | None, 'd': ast.expr_context}
t(lambda: Typed(1))
t(lambda: Typed())
class Partial(ast.AST):
    _fields = ('a', 'b')
    _field_types = {'a': int}
t(lambda: Partial(1))
class Sub(ast.stmt):
    pass
t(lambda: Sub())
class WithAttrs(ast.AST):
    _attributes = ('x',)
t(lambda: WithAttrs(x=1))
t(lambda: WithAttrs(y=1))
class BadFields(ast.AST):
    _fields = (1, 2)
t(lambda: BadFields(1))
class NoFields(ast.AST):
    _fields = 5
t(lambda: NoFields())

# Attributes are ordinary
n = ast.Name('x')
n.foo = 3
print(n.foo, n.__dict__)
del n.id
t(lambda: n.id)
print(repr(ast.Name.__init__)[:30], ast.AST.__new__ is not object.__new__)
print(ast.Name.__dict__.get('__init__'), ast.AST.__dict__['__dict__'])
n.__dict__ = {'id': 'q', 'ctx': ast.Load()}
print(repr(n))
print(type(ast.Name.__weakref__).__name__, hasattr(ast.AST, '__weakref__'))
print(isinstance(ast.Name('x'), ast.expr), issubclass(ast.Name, ast.AST), ast.Name.__base__)
match ast.BinOp(1, ast.Add(), 2):
    case ast.BinOp(l, ast.Add(), r):
        print('matched', l, r)
