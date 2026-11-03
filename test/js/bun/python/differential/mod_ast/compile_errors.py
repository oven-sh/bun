import _ast as ast

def loc(n, line=1, col=0):
    n.lineno = line; n.col_offset = col; n.end_lineno = line; n.end_col_offset = col
    return n
def t(label, f):
    try:
        r = f()
    except BaseException as e:
        print(label, '->', type(e).__name__ + ':', e)
    else:
        print(label, '-> ok', type(r).__name__)
C = lambda v=1: loc(ast.Constant(v))
N = lambda n='x', ctx=None: loc(ast.Name(n, ctx or ast.Load()))
def expr(label, node, mode='eval'):
    t(label, lambda: compile(ast.Expression(node), '<e>', 'eval'))
def stmt(label, *nodes):
    t(label, lambda: compile(ast.Module(list(nodes), []), '<s>', 'exec'))
P = lambda: loc(ast.Pass())
X = lambda v: loc(ast.Expr(v))

# The mode.
t('mode1', lambda: compile(ast.Module([], []), '<m>', 'eval'))
t('mode2', lambda: compile(ast.Expression(C()), '<m>', 'exec'))
t('mode3', lambda: compile(ast.Module([], []), '<m>', 'single'))
t('mode4', lambda: compile(ast.Interactive([]), '<m>', 'single'))
t('mode5', lambda: compile(C(), '<m>', 'eval'))
t('mode6', lambda: compile(ast.Expression(C()), '<m>', 'func_type'))
t('mode7', lambda: compile(ast.Expression(C()), '<m>', 'func_type', ast.PyCF_ONLY_AST))
t('mode8', lambda: compile(ast.FunctionType([], C()), '<m>', 'func_type', ast.PyCF_ONLY_AST))
t('mode9', lambda: compile(ast.AST(), '<m>', 'exec'))
t('mode10', lambda: compile(ast.Load(), '<m>', 'exec'))

# Fields.
expr('missing-lineno', ast.Constant(1))
n = ast.Constant(1); n.lineno = 1
expr('missing-col', n)
n = ast.Constant(1); n.lineno = 1; n.col_offset = 0
expr('no-end', n)
n = ast.Constant(1); n.lineno = 'a'; n.col_offset = 0
expr('bad-lineno', n)
n = ast.Constant(1); n.lineno = 1.5; n.col_offset = 0
expr('float-lineno', n)
n = ast.Constant(1); n.lineno = 2 ** 40; n.col_offset = 0
expr('huge-lineno', n)
n = ast.Constant(1); n.lineno = True; n.col_offset = False
expr('bool-lineno', n)
n = ast.Constant(1); n.lineno = None; n.col_offset = 0
expr('none-lineno', n)
n = loc(ast.Constant.__new__(ast.Constant))
expr('missing-value', n)
n = loc(ast.Name.__new__(ast.Name))
expr('missing-id', n)
n = loc(ast.Name.__new__(ast.Name)); n.id = 'x'
expr('missing-ctx', n)
expr('id-none', loc(ast.Name(None, ast.Load())))
expr('id-int', loc(ast.Name(3, ast.Load())))
expr('id-bytes', loc(ast.Name(b'x', ast.Load())))
class S(str): pass
expr('id-strsub', loc(ast.Name(S('x'), ast.Load())))
expr('ctx-none', loc(ast.Name('x', None)))
expr('ctx-int', loc(ast.Name('x', 1)))
expr('ctx-op', loc(ast.Name('x', ast.Add())))
expr('ctx-class', loc(ast.Name('x', ast.Load)))
expr('body-none', None)
expr('body-int', 5)
expr('body-stmt', P())
expr('body-str', 'x')
expr('binop-left-none', loc(ast.BinOp(None, ast.Add(), C())))
expr('binop-op-none', loc(ast.BinOp(C(), None, C())))
expr('binop-op-wrong', loc(ast.BinOp(C(), ast.And(), C())))
expr('binop-right-none', loc(ast.BinOp(C(), ast.Add(), None)))
expr('list-notlist', loc(ast.List((C(),), ast.Load())))
expr('list-none', loc(ast.List(None, ast.Load())))
expr('list-str', loc(ast.List('ab', ast.Load())))
expr('list-has-none', loc(ast.List([None], ast.Load())))
expr('list-has-int', loc(ast.List([1], ast.Load())))
expr('call-kw-none', loc(ast.Call(N(), [], [None])))
expr('call-kw-int', loc(ast.Call(N(), [], [1])))
expr('call-kw-noloc', loc(ast.Call(N(), [], [ast.keyword('a', C())])))
expr('call-kw-novalue', loc(ast.Call(N(), [], [loc(ast.keyword('a', None))])))
expr('lambda-args-none', loc(ast.Lambda(None, C())))
expr('lambda-args-int', loc(ast.Lambda(1, C())))
expr('lambda-arg-noname', loc(ast.Lambda(ast.arguments(args=[loc(ast.arg(None))]), C())))
expr('compare-ops', loc(ast.Compare(C(), [None], [C()])))
expr('compare-ops2', loc(ast.Compare(C(), [ast.Add()], [C()])))
expr('fv-conv', loc(ast.FormattedValue(C(), 'r', None)))
expr('fv-conv-none', loc(ast.FormattedValue(C(), None, None)))
expr('const-kind', loc(ast.Constant(1, 5)))
expr('const-kind-b', loc(ast.Constant(1, 'b')))
stmt('stmt-int', 1)
stmt('stmt-expr', C())
stmt('stmt-none', None)
t('body-notlist', lambda: compile(ast.Module((), []), '<m>', 'exec'))
t('ignores-notlist', lambda: compile(ast.Module([], 5), '<m>', 'exec'))
t('ignores-bad', lambda: compile(ast.Module([], [5]), '<m>', 'exec'))
t('ignores-none', lambda: compile(ast.Module([], [None]), '<m>', 'exec'))
t('ignores-tag', lambda: compile(ast.Module([], [ast.TypeIgnore(1, None)]), '<m>', 'exec'))
t('ignores-tag2', lambda: compile(ast.Module([], [ast.TypeIgnore(1, 5)]), '<m>', 'exec'))
t('ignores-ok', lambda: compile(ast.Module([], [ast.TypeIgnore(1, '')]), '<m>', 'exec'))
stmt('def-noname', loc(ast.FunctionDef(None, ast.arguments(), [P()])))
stmt('def-tc', loc(ast.FunctionDef('f', ast.arguments(), [P()], type_comment=5)))
stmt('import-alias', loc(ast.Import([ast.alias('a')])))
stmt('import-alias-none', loc(ast.Import([loc(ast.alias(None))])))
stmt('import-lazy', loc(ast.Import([loc(ast.alias('sys'))], 'x')))
stmt('importfrom-level', loc(ast.ImportFrom('a', [loc(ast.alias('b'))], 'x')))
stmt('annassign-simple', loc(ast.AnnAssign(N('a', ast.Store()), C(), None, None)))
stmt('with-item', loc(ast.With([1], [P()])))
stmt('with-item-none', loc(ast.With([ast.withitem(None)], [P()])))
stmt('match-case', loc(ast.Match(C(), [ast.match_case(None, None, [P()])])))
stmt('match-case-int', loc(ast.Match(C(), [ast.match_case(1, None, [P()])])))
stmt('match-noend', loc(ast.Match(C(), [ast.match_case(ast.MatchAs(lineno=1, col_offset=0), None, [P()])])))
stmt('try-handler', loc(ast.Try([P()], [1], [], [])))
stmt('typeparam', loc(ast.TypeAlias(N('A', ast.Store()), [1], C())))
stmt('typeparam-noend', loc(ast.TypeAlias(N('A', ast.Store()), [ast.TypeVar('T', lineno=1, col_offset=0)], C())))
stmt('comp', X(loc(ast.ListComp(C(), [1]))))
stmt('comp-async', X(loc(ast.ListComp(C(), [ast.comprehension(N('i', ast.Store()), C(()), [], None)]))))
class Growing(list):
    pass
g = []
class Evil(ast.Pass):
    lineno = 1; col_offset = 0
    @property
    def end_lineno(self):
        g.append(P())
        return 1
    end_col_offset = 0
g.append(Evil())
stmt('changed-size', loc(ast.If(C(), g, [])))
class Raises:
    @property
    def lineno(self):
        raise KeyError('boom')
stmt('raises', Raises())

# Positions.
def at(n, a, b, c, d):
    n.lineno, n.col_offset, n.end_lineno, n.end_col_offset = a, b, c, d
    return n
expr('pos1', at(ast.Constant(1), 2, 0, 1, 0))
expr('pos2', at(ast.Constant(1), -1, 0, 1, 0))
expr('pos3', at(ast.Constant(1), 1, -1, 1, 0))
expr('pos4', at(ast.Constant(1), 1, 5, 1, 2))
expr('pos5', at(ast.Constant(1), -1, -1, -1, -1))
expr('pos6', at(ast.Constant(1), 0, 0, 0, 0))
expr('pos7', at(ast.Constant(1), 1, 5, 2, 2))
expr('pos8', at(ast.Constant(1), 10 ** 6, 10 ** 6, 10 ** 6, 10 ** 6))
expr('pos9', at(ast.Constant(1), 2 ** 31 - 1, 2 ** 31 - 1, 2 ** 31 - 1, 2 ** 31 - 1))
expr('pos10', at(ast.Constant(1), -5, 3, -5, 3))
stmt('pos-stmt', at(ast.Pass(), 3, 0, 2, 0))
stmt('pos-arg', loc(ast.FunctionDef('f', ast.arguments(args=[at(ast.arg('a'), 3, 0, 2, 0)]), [P()])))
stmt('pos-handler', loc(ast.Try([P()], [at(ast.ExceptHandler(None, None, [P()]), 3, 0, 2, 0)], [], [])))
stmt('pos-handler-star', loc(ast.TryStar([P()], [at(ast.ExceptHandler(C(), None, [P()]), 3, 0, 2, 0)], [], [])))
stmt('pos-pattern', loc(ast.Match(C(), [ast.match_case(at(ast.MatchAs(), 3, 0, 2, 0), None, [P()])])))
stmt('pos-typeparam', loc(ast.TypeAlias(N('A', ast.Store()), [at(ast.TypeVar('T'), 3, 0, 2, 0)], C())))

# Constants.
for v in ([1], {1: 2}, {1}, object(), int, (1, [2]), frozenset({(1, (2, range(1)))}), bytearray(b'x'), range(3), S('x'), NotImplemented, ast.Load()):
    expr('const-' + type(v).__name__, C(v))
class I(int): pass
class F(float): pass
class T(tuple): pass
expr('const-I', C(I(1))); expr('const-F', C(F(1))); expr('const-T', C(T()))
