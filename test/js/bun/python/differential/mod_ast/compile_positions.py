# Where code compiled from a tree says it comes from.
import _ast as ast

def parse(s, mode='exec'):
    return compile(s, '<t>', mode, ast.PyCF_ONLY_AST)

def walk(node):
    yield node
    for name in node._fields:
        value = getattr(node, name, None)
        if isinstance(value, ast.AST):
            yield from walk(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, ast.AST):
                    yield from walk(item)

def lines_of(e):
    out = []
    tb = e.__traceback__
    while tb:
        out.append((tb.tb_frame.f_code.co_name, tb.tb_lineno))
        tb = tb.tb_next
    return out[1:]

def run(tree, label):
    ns = {}
    try:
        exec(compile(tree, '<tree>', 'exec'), ns)
        print(label, 'no error')
    except Exception as e:
        print(label, type(e).__name__, lines_of(e))
    return ns

src = '''def f(x):
    y = x + 1
    return g(
        y,
        1 / x)

def g(a, b):
    return a

class K:
    def m(self):
        raise ValueError(
            "no")

lam = lambda: 1 / 0
f(1)
'''
tree = parse(src + 'f(0)\n')
ns = run(tree, 'plain')
print(ns['f'].__code__.co_firstlineno, ns['g'].__code__.co_firstlineno, ns['K'].m.__code__.co_firstlineno, ns['lam'].__code__.co_firstlineno)

# Shifted.
tree = parse(src + 'K().m()\n')
for n in walk(tree):
    if hasattr(n, 'lineno'):
        n.lineno += 100; n.end_lineno += 100
ns = run(tree, 'shifted')
print(ns['f'].__code__.co_firstlineno, ns['K'].m.__code__.co_firstlineno)

# Everything on one line.
tree = parse(src + 'lam()\n')
for n in walk(tree):
    if hasattr(n, 'lineno'):
        n.lineno = n.end_lineno = 7; n.col_offset = n.end_col_offset = 0
ns = run(tree, 'one line')
print(ns['f'].__code__.co_firstlineno)

# The body of a function before the function, and far away.
tree = parse(src + 'f(0)\n')
fn = tree.body[0]
for n in walk(fn.body[1]):
    if hasattr(n, 'lineno'):
        n.lineno = n.end_lineno = 1000
for n in walk(fn.body[0]):
    if hasattr(n, 'lineno'):
        n.lineno = n.end_lineno = 1
fn.lineno = 50; fn.end_lineno = 60
ns = run(tree, 'scattered')
print(ns['f'].__code__.co_firstlineno)

# Lines 0 and -1, huge lines and columns.
for line, col in ((10 ** 6, 0), (4 * 10 ** 6, 0), (3, 10 ** 6), (3, 2 ** 31 - 1)):
    tree = parse('1 / 0\n')
    for n in walk(tree):
        if hasattr(n, 'lineno'):
            n.lineno = n.end_lineno = line; n.col_offset = n.end_col_offset = col
    run(tree, 'at %d,%d' % (line, col))

# No end positions.
tree = parse('x = 1\n\n\n1 / 0\n')
for n in walk(tree):
    if hasattr(n, 'lineno'):
        del n.end_lineno, n.end_col_offset
run(tree, 'no ends')

# Errors of the compiler say where.
for s in ('return 1', 'def f():\n  x = 1\n  global x', 'break', 'def f(a, a): pass', '\n\nfor x in y:\n  def f():\n    continue'):
    tree = parse(s)
    try:
        compile(tree, '<tree>', 'exec')
    except SyntaxError as e:
        print(e.msg, e.filename, e.lineno, e.offset, e.end_lineno, e.end_offset, e.text)

# Warnings too.
import warnings
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter('always')
    compile(parse('\n\nx is 1\n'), '<tree>', 'exec')
    compile(parse('def f():\n  try:\n    pass\n  finally:\n    return 1\n'), '<tree>', 'exec')
    parse('def f():\n  try:\n    pass\n  finally:\n    return 1\n')
    print([(x.category.__name__, str(x.message), x.filename, x.lineno) for x in w])

# Generators, comprehensions and classes compiled from a tree.
tree = parse('def gen():\n    yield 1\n    yield 1 / 0\n\nr = [i for i in gen()]\n')
run(tree, 'generator')
tree = parse('r = [\n  1 / i\n  for i in (1, 0)]\n')
run(tree, 'comprehension')
tree = parse('class C:\n    x = 1\n    y = 1 / 0\n')
run(tree, 'class')
