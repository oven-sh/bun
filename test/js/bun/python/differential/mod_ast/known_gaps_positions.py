# Known gaps: code has no line 0 or -1, and lines past 4194304 are not kept.
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

# Lines 0 and -1, huge lines and columns.
for line, col in ((0, 0), (-1, -1), (5 * 10 ** 6, 0), (2 ** 31 - 1, 0)):
    tree = parse('1 / 0\n')
    for n in walk(tree):
        if hasattr(n, 'lineno'):
            n.lineno = n.end_lineno = line; n.col_offset = n.end_col_offset = col
    run(tree, 'at %d,%d' % (line, col))

