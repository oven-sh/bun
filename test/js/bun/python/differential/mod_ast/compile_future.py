# Trees with `from __future__ import annotations`, and flags given to compile() with a tree.
import _ast as ast

def parse(s, mode='exec', flags=0):
    return compile(s, '<t>', mode, ast.PyCF_ONLY_AST | flags, dont_inherit=True)

src = '''from __future__ import annotations
x: List[ int ] = 1
y: "quoted"
def f(a: Dict[str,  int], b: 'B' = 2, *c: (1 +
        2), **d: lambda q: q) -> Optional[ "T" ]: pass
class K:
    z: Tuple[int, ...] = ()
    w: a.b.c[d:e, ::2]
'''
ns = {}
exec(compile(parse(src), '<tree>', 'exec', dont_inherit=True), ns)
print(ns['__annotations__'])
print(ns['f'].__annotations__)
print(ns['K'].__annotations__)
ns2 = {}
exec(compile(src, '<src>', 'exec', dont_inherit=True), ns2)
print(ns2['__annotations__'] == ns['__annotations__'], ns2['f'].__annotations__ == ns['f'].__annotations__, ns2['K'].__annotations__ == ns['K'].__annotations__)

# The flag rather than the statement.
import __future__
tree = parse('v: Foo[ bar ] = 1\n')
ns = {}
code = compile(tree, '<tree>', 'exec', __future__.annotations.compiler_flag, dont_inherit=True)
exec(code, ns)
print(ns['__annotations__'], bool(code.co_flags & __future__.annotations.compiler_flag))

# Top-level await.
tree = parse('await x\n', flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
try:
    compile(tree, '<tree>', 'exec', dont_inherit=True)
except SyntaxError as e:
    print('SyntaxError', e.msg)
code = compile(tree, '<tree>', 'exec', ast.PyCF_ALLOW_TOP_LEVEL_AWAIT, dont_inherit=True)
print(bool(code.co_flags & 0x80))

# optimize
tree = parse('"doc"\nassert 0, "no"\nr = __debug__\ndef f():\n  "fdoc"\n')
for opt in (0, 1, 2):
    ns = {}
    try:
        exec(compile(tree, '<tree>', 'exec', dont_inherit=True, optimize=opt), ns)
        print(opt, ns['r'], ns.get('__doc__'), ns['f'].__doc__)
    except AssertionError as e:
        print(opt, 'AssertionError', e)

# The tree is not changed by being compiled.
def dump(node):
    if isinstance(node, ast.AST):
        return type(node).__name__ + '(' + ','.join(n + '=' + dump(getattr(node, n)) for n in node._fields + node._attributes) + ')'
    if isinstance(node, list):
        return '[' + ','.join(dump(x) for x in node) + ']'
    return repr(node)
before = dump(tree)
compile(tree, '<tree>', 'exec', optimize=2)
compile(tree, '<tree>', 'exec', ast.PyCF_OPTIMIZED_AST, optimize=2)
print(dump(tree) == before)
