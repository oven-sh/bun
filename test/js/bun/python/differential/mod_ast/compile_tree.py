import _ast as ast

def parse(s, mode='exec', flags=0, **kw):
    return compile(s, '<t>', mode, ast.PyCF_ONLY_AST | flags, **kw)

# Parse, compile the tree, run.
src = '''
import sys
def fib(n):
    "doc"
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
class C(object, metaclass=type):
    x: int = 3
    def m(self, *a, k=2, **kw):
        return [self.x, a, k, kw]
    @property
    def p(self): return f"{self.x!r:>4}|{self.x:{self.x}}"
out = [fib(i) for i in range(10)]
d = {k: v for k, v in zip("abc", (1, 2, 3)) if v != 2}
s = {*out, *d}
g = sum(x * x for x in out)
c = C()
try:
    1 / 0
except ZeroDivisionError as e:
    err = type(e).__name__
else:
    err = None
finally:
    fin = True
with memoryview(b"ab") as mv:
    w = mv[0]
match (1, [2, 3], {"k": 4}):
    case (1, [x, *rest], {"k": v, **others}) if v > 3:
        m = (x, rest, v, others)
    case _:
        m = None
lam = (lambda a, /, b=2, *, c=3: a + b + c)(1)
n = -5 ** 2 + (3 if out else 4) - ~1
big = 123456789012345678901234567890 * -1
z = 1.5 + 2j
b = b"bytes" + b"\\x00"
w2 = (y := 10) + y
del y
while n:
    n = 0
    continue
else:
    n = 'else'
type Alias[T] = list[T]
def gen[T](x: T) -> T:
    yield x
    yield from (1, 2)
assert out, "msg"
global_names = sorted(k for k in dir() if not k.startswith('_'))
'''
tree = parse(src)
code = compile(tree, '<tree>', 'exec')
print(type(code).__name__, code.co_filename, code.co_name)
ns = {}
exec(code, ns)
for k in ('out', 'd', 'g', 'err', 'fin', 'w', 'm', 'lam', 'n', 'big', 'z', 'b', 'w2'):
    print(k, ns[k])
print(sorted(ns["s"], key=str), ns['c'].m(1, 2, q=3), ns['c'].p, ns['fib'].__doc__, list(ns['gen'](0)), ns['Alias'].__name__, ns['C'].__annotations__)

print(eval(compile(parse('1 + 2 * 3', 'eval'), '<e>', 'eval')))
exec(compile(parse('1 + 2; x = 5; x', 'single'), '<s>', 'single'))

# Trees made by hand.
def loc(n, line=1, col=0):
    n.lineno = line; n.col_offset = col; n.end_lineno = line; n.end_col_offset = col
    return n
def E(node):
    return eval(compile(ast.Expression(node), '<hand>', 'eval'))
C = lambda v: loc(ast.Constant(v))
print(E(C(42)), E(C(-42)), E(C(None)), E(C(...)), E(C(True)), E(C('s')), E(C(b'b')), E(C(1.5)), E(C(-0.0)), E(C(2j)))
print(E(C((1, 'a', (2.0, None), frozenset({3})))), E(C(frozenset({1, 2}))), E(C(())))
print(E(C(10 ** 30)), E(C(-10 ** 30)), E(C(2 ** 63)), E(C(-2 ** 63)), E(C(2 ** 53)), E(C(-2 ** 64 - 1)))
print(E(loc(ast.BinOp(C(1), ast.Add(), C(2)))), E(loc(ast.List([C(1), C(2)], ast.Load()))), E(loc(ast.Tuple([], ast.Load()))))
print(E(loc(ast.Compare(C(1), [ast.Lt(), ast.LtE()], [C(2), C(2)]))), E(loc(ast.BoolOp(ast.Or(), [C(0), C(''), C(3)]))))
print(E(loc(ast.JoinedStr([C('a'), loc(ast.FormattedValue(C(1), -1, None)), loc(ast.FormattedValue(C('x'), ord('r'), C('>5')))]))))
print(E(loc(ast.Dict([C(1), None], [C(2), loc(ast.Dict([C(3)], [C(4)]))]))))
print(E(loc(ast.Call(loc(ast.Name('len', ast.Load())), [C('abc')], []))))
print(E(loc(ast.Call(loc(ast.Name('dict', ast.Load())), [], [loc(ast.keyword('a', C(1))), loc(ast.keyword(None, loc(ast.Dict([C('b')], [C(2)]))))]))))
print(E(loc(ast.Subscript(C('hello'), loc(ast.Slice(C(1), None, C(2))), ast.Load()))))
print(E(loc(ast.Slice(C(1), C(2), None))))
print(E(loc(ast.IfExp(C(0), C('y'), C('n')))), E(loc(ast.UnaryOp(ast.Not(), C(0)))), E(loc(ast.UnaryOp(ast.USub(), C(3)))))
print(E(loc(ast.Lambda(ast.arguments(args=[loc(ast.arg('q'))], defaults=[C(9)]), loc(ast.Name('q', ast.Load())))))())
print(E(loc(ast.ListComp(loc(ast.Name('i', ast.Load())), [ast.comprehension(loc(ast.Name('i', ast.Store())), C((1, 2, 3)), [], 0)]))))

# Missing optional fields and lists.
m = ast.Module.__new__(ast.Module)
print(compile(m, '<m>', 'exec').co_name)
f = loc(ast.FunctionDef.__new__(ast.FunctionDef))
f.name = 'f'; f.args = ast.arguments.__new__(ast.arguments); f.body = [loc(ast.Return(C(7)))]
ns = {}
exec(compile(ast.Module([f]), '<m>', 'exec'), ns)
print(ns['f']())

# A subclass of a node class, and of list.
class MyConst(ast.Constant):
    pass
class L(list):
    pass
print(E(loc(MyConst(5))), E(loc(ast.List(L([C(1)]), ast.Load()))))
# Products are taken by their attributes alone.
class Duck:
    arg = 'dk'; annotation = None; type_comment = None; lineno = 1; col_offset = 0
print(E(loc(ast.Lambda(ast.arguments(args=[Duck()]), loc(ast.Name('dk', ast.Load())))))(3))

# Round trips.
def dump(node):
    if isinstance(node, ast.AST):
        return type(node).__name__ + '(' + ','.join(n + '=' + dump(getattr(node, n)) for n in node._fields + node._attributes) + ')'
    if isinstance(node, list):
        return '[' + ','.join(dump(x) for x in node) + ']'
    return repr(node)
again = compile(tree, '<again>', 'exec', ast.PyCF_ONLY_AST)
print(again is tree, dump(again) == dump(tree), again.body[0] is tree.body[0])
ft = parse('(int, *str, **dict) -> bool', 'func_type')
print(dump(compile(ft, '<ft>', 'func_type', ast.PyCF_ONLY_AST)))
print(dump(compile(ast.Expression(C((1, frozenset({2}), -10 ** 40))), '<c>', 'eval', ast.PyCF_ONLY_AST)))
