import ast

src = '''"""Module doc."""
import os, sys as s
from a.b import c as d
@deco(1)
def f(a, /, b: int = 1, *args, c=2, **kw) -> str:
    """Doc
       of f."""
    x = [i * 2 for i in range(b) if i]
    y = {k: v for k, v in kw.items()}
    z = lambda q=1: q ** -2
    with open(a) as fh, ctx():
        pass
    try:
        raise E from None
    except (A, B) as e:
        del e
    else:
        return f"{a!r:>{b}} {x=}"
    finally:
        global g
    while x: x -= 1
    assert x, "m"
    return x if y else (yield)
class K(B, metaclass=M):
    a: int = 1
    async def m(self):
        async for i in self: await i
        async with self as w: pass
match v:
    case [1, *r] | {"k": 2, **o}: pass
    case P(x=1) as p if p: pass
type T[U: int, *V, **W] = dict[U, V]
t = t"a{b!s:c}"
n = not a and b or c < d <= e is not f not in g
u = -1 + ~2 // 3 @ 4 % 5 << 6 >> 7 & 8 ^ 9 | 10
w = a[1:2, ::3, ...], *b, (c := 1), 1e100, 2j, b"x", None, True
'''
tree = ast.parse(src)
print(ast.dump(tree)[:600])
print(ast.dump(tree.body[3], indent=2)[:900])
print(ast.dump(tree.body[1], annotate_fields=False), ast.dump(tree.body[1], include_attributes=True), ast.dump(tree.body[1], show_empty=True))
print(ast.dump(ast.parse('x', mode='eval'), indent='\t'), ast.dump(ast.Name('x')), ast.dump(ast.Module()), ast.dump(ast.Module(), show_empty=True))
text = ast.unparse(tree)
print(text)
print(ast.dump(ast.parse(text)) == ast.dump(tree))
print(ast.get_docstring(tree), repr(ast.get_docstring(tree.body[3])), repr(ast.get_docstring(tree.body[3], clean=False)), ast.get_docstring(tree.body[4]))
print([type(n).__name__ for n in ast.walk(tree)][:25], sum(1 for _ in ast.walk(tree)))
print([(k, type(v).__name__) for k, v in ast.iter_fields(tree.body[3])], [type(n).__name__ for n in ast.iter_child_nodes(tree.body[3])][:8])
print(ast.get_source_segment(src, tree.body[3].body[1]), '|', ast.get_source_segment(src, tree.body[3].body[1].value.elt), '|', ast.get_source_segment(src, tree.body[3], padded=True)[:30])

for s in ['1', '-1', '+1', '1+2j', '-1-2j', '"a" "b"', 'b"a"', '[1, (2,), {3}, {4: 5}]', 'None', 'True', '...', 'set()', '{*()}', 'x', '1+1', 'f()', '-"a"', '[1, x]', '{1: x}', '1 if 1 else 2', '  1', '\n1', '']:
    try:
        print(repr(s), repr(ast.literal_eval(s)))
    except Exception as e:
        print(repr(s), type(e).__name__, e)

class Count(ast.NodeVisitor):
    def __init__(self): self.names = []
    def visit_Name(self, n): self.names.append((n.id, type(n.ctx).__name__))
    def visit_FunctionDef(self, n):
        self.names.append('def ' + n.name); self.generic_visit(n)
c = Count(); c.visit(tree); print(c.names[:12], len(c.names))
class Swap(ast.NodeTransformer):
    def visit_BinOp(self, n):
        self.generic_visit(n)
        return ast.copy_location(ast.BinOp(n.right, n.op, n.left), n)
    def visit_Pass(self, n): return None
    def visit_Assert(self, n): return [n, ast.Expr(ast.Constant(1))]
t2 = ast.fix_missing_locations(Swap().visit(ast.parse('x = 1 - 2 * 3\nif x:\n  pass\n  y = 1\nassert x')))
print(ast.unparse(t2)); ns = {}; exec(compile(t2, '<t2>', 'exec'), ns); print(ns['x'])
t3 = ast.increment_lineno(ast.parse('a\nb'), 5); print([(n.lineno, n.end_lineno) for n in t3.body])
print(ast.compare(ast.parse('a+b'), ast.parse('a + b')), ast.compare(ast.parse('a+b'), ast.parse('a+c')), ast.compare(ast.parse('a+b'), ast.parse('a  +b'), compare_attributes=True))

import copy, pickle
n = tree.body[3]
for m in (copy.copy(n), copy.deepcopy(n), pickle.loads(pickle.dumps(n)), copy.replace(n, name='g')):
    print(type(m).__name__, m.name, m is n, m.body is n.body, ast.dump(m) == ast.dump(n), m.lineno)
print(isinstance(ast.Constant(1), ast.expr), ast.Constant(1).value, ast.Constant.__match_args__, ast.PyCF_ONLY_AST)
for name in ('Num', 'Str', 'Bytes', 'NameConstant', 'Ellipsis', 'Index', 'ExtSlice', 'Suite', 'AugLoad', 'Param', 'slice'):
    print(name, hasattr(ast, name))
print(ast.parse('x = 1 # type: int', type_comments=True).body[0].type_comment, ast.parse('(int) -> str', mode='func_type').returns.id, ast.parse('__debug__', optimize=1, mode='eval').body.value)
