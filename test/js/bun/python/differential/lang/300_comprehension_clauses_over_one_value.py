# Clauses of comprehensions over one value. `for y in [e]` is an assignment to CPython's compiler and to this one: there is no loop. Where a condition of such a clause fails, and behind
# a further clause, the loop around it goes on. `[z for x in a for y in [x] if y for z in b]` once jumped to where the loop of the clause would have begun, and never ended.
#
# First what comprehensions of two to four clauses make, by the kinds of the clauses, with up to two conditions at each; then such clauses in company; then what tools are told.
import sys, itertools, zlib
LOG = []
def t(tag, v):
    LOG.append((tag, v))
    return (v + tag) % 3 != 0
A = [1, 2, 3]
CLAUSES = {
    'loop': 'for {v} in A',
    '[e]': 'for {v} in [{e}]',
    '(e,)': 'for {v} in ({e},)',
    '[e][:]': 'for {v} in [{e}][:]',
    '[*[e]]': 'for {v} in [*[{e}]]',
    '{e}': 'for {v} in {{{e}}}',
}
FORMS = {'list': '[{r} {c}]', 'set': 'sorted({{{r} {c}}})', 'dict': '{{{r}: 0 {c}}}', 'generator': 'list({r} {c})'}
def conditions(n):
    yield (0,) * n
    yield (1,) * n
    for i in range(n):
        for k in (1, 2) if n < 4 and i else (1,):
            yield tuple(k if j == i else 0 for j in range(n))
def source(kinds, ifs, form):
    parts = []; names = []
    for i, (kind, count) in enumerate(zip(kinds, ifs)):
        v = 'x%d' % i
        e = '%s + %d' % (names[-1], i) if names else '1'
        parts.append(CLAUSES[kind].format(v=v, e=e) + ''.join(' if t(%d, %s)' % (10 * i + k, v) for k in range(count)))
        names.append(v)
    return FORMS[form].format(r='(' + ', '.join(names) + ',)', c=' '.join(parts))
def rows():
    for n in (2, 3, 4):
        for kinds in itertools.product(*([('loop', '[e]')] + [tuple(CLAUSES) if n < 4 else ('loop', '[e]')] * (n - 1))):
            del LOG[:]
            values = eval('(' + ', '.join(source(kinds, ifs, form) for ifs in conditions(n) for form in FORMS) + ')')
            yield '%s: %d %08x' % (' '.join(kinds), sum(map(len, values)), zlib.crc32(repr((values, LOG)).encode()))
print('\n'.join(rows()))

# In company: a walrus, a lambda, other comprehensions, cells, classes, asynchronous clauses, exceptions.
B = [10, 20]
class Agen:
    def __init__(self, values): self.values = list(values)
    def __aiter__(self): return self
    async def __anext__(self):
        if not self.values: raise StopAsyncIteration
        return self.values.pop(0)
def run(coroutine):
    try:
        coroutine.send(None)
    except StopIteration as e:
        return e.value
    raise RuntimeError('it waits')
def show(name, function):
    del LOG[:]
    try:
        value = function()
    except Exception as e:
        value = '%s: %s' % (type(e).__name__, e)
    print(name, '|', value, '|', LOG)

show('a condition, and a clause behind it', lambda: [z for x in A for y in [x] if y for z in B])
show('it fails for some', lambda: [z for x in A for y in [x] if y - 1 for z in B])
show('two in a row', lambda: [(y, w, z) for x in A for y in [x] if t(0, y) for w in (y,) if t(1, w) for z in B])
show('two in a row, the first without a condition', lambda: [(y, w, z) for x in A for y in [x] for w in (y,) if t(1, w) for z in B])
show('three in a row', lambda: [(y, w, v, z) for x in A for y in [x] if t(0, y) for w in [y + 1] if t(1, w) for v in [w + 1] if t(2, v) for z in B])
show('last', lambda: [y for x in A for z in B for y in [x + z] if t(0, y)])
show('walrus', lambda: [(y, k, z) for x in A for y in [x] if (k := t(0, y)) for z in B])
show('lambda', lambda: [z for x in A for y in [x] if (lambda: t(0, y))() for z in B])
show('lambdas made', lambda: [f() for f in [(lambda: (y, z)) for x in A for y in [x] if t(0, y) for z in B]])
show('and', lambda: [z for x in A for y in [x] if t(0, y) and t(1, y) for z in B])
show('or', lambda: [z for x in A for y in [x] if t(0, y) or t(1, y) for z in B])
show('not', lambda: [z for x in A for y in [x] if not t(0, y) for z in B])
show('conditional expression', lambda: [z for x in A for y in [x] if (t(0, y) if t(1, y) else t(2, y)) for z in B])
show('a chain', lambda: [z for x in A for y in [x] if 0 < y < 3 for z in B])
show('always', lambda: [z for x in A for y in [x] if 1 for z in B])
show('never', lambda: [z for x in A for y in [x] if 0 for z in B])
show('never, then a condition', lambda: [z for x in A for y in [x] if 0 if t(0, y) for z in B])
show('is None', lambda: [z for x in A for y in [None] if y is None for z in B])
show('is not None', lambda: [z for x in A for y in [None] if y is not None for z in B])
show('a comprehension in the value', lambda: [z for x in A for y in [[w for w in A if t(0, w)]] if y for z in y])
show('a comprehension in the condition', lambda: [z for x in A for y in [x] if [w for v in A for w in [v] if t(0, w) for u in B] for z in B])
show('a comprehension is the element', lambda: [[(y, w) for v in B for w in [v] if t(1, w) for u in A] for x in A for y in [x] if t(0, y) for z in B])
show('the same name', lambda: [x for x in A for x in [x + 1] if t(0, x) for x in [x, x + 1]])
show('unpacking', lambda: [(p, q, z) for x in A for p, q in [(x, x + 1)] if t(0, q) for z in B])
show('a starred target', lambda: [(p, q, z) for x in A for p, *q in [(x, x + 1, x + 2)] if t(0, p) for z in B])
show('an attribute is the target', lambda: [(t.y, z) for x in A for t.y in [x] if t(0, t.y) for z in B])
show('it raises in the condition', lambda: [z for x in A for y in [x] if 1 // (y - 2) for z in B])
show('it raises in the value', lambda: [z for x in A for y in [1 // (x - 2)] if y for z in B])
show('set', lambda: sorted({z + y for x in A for y in [x] if t(0, y) for z in B}))
show('dict', lambda: {y: z for x in A for y in [x] if t(0, y) for z in B})
show('generator', lambda: list(z for x in A for y in [x] if t(0, y) for z in B))
show('sum of a generator', lambda: sum(z for x in A for y in [x] if t(0, y) for z in B))
def closed():
    g = ((y, z) for x in A for y in [x] if t(0, y) for z in B)
    first = next(g); g.close()
    return first, list(g)
show('a generator that is closed', closed)
class K:
    values = [z for x in [1, 2, 3] for y in [x] if y - 1 for z in [10, 20]]
    names = sorted(n for n in dir() if not n.startswith('_'))
show('in a class', lambda: (K.values, K.names))
show('at the top of a module', lambda: eval(compile('[z for x in A for y in [x] if t(0, y) for z in B]', 'm', 'eval')))
def local():
    y = 'outside'; z = 'outside'
    r = [z for x in A for y in [x] if t(0, y) for z in B]
    return r, y, z
show('the variables outside', local)
def cells():
    y = 'outside'
    r = [(lambda: y) for x in A for y in [x] if t(0, y) for z in B]
    return [f() for f in r], y
show('cells', cells)
async def around():
    return [z async for x in Agen(A) for y in [x] if t(0, y) for z in B]
show('async for around it', lambda: run(around()))
async def behind():
    return [z for x in A for y in [x] if t(0, y) async for z in Agen(B)]
show('async for behind it', lambda: run(behind()))
async def both():
    return [(w, z) async for x in Agen(A) for y in [x] if t(0, y) async for z in Agen(B) for w in (z + y,) if t(1, w) for v in A]
show('async for around it and behind it', lambda: run(both()))
async def awaited():
    async def c(v): return t(0, v)
    return [z for x in A for y in [x] if await c(y) for z in B]
show('await in the condition', lambda: run(awaited()))
async def agen():
    g = (z async for x in Agen(A) for y in [x] if t(0, y) for z in B)
    return [v async for v in g]
show('an asynchronous generator expression', lambda: run(agen()))
show('not the short form: a slice', lambda: [z for x in A for y in [x][:] if t(0, y) for z in B])
show('not the short form: starred', lambda: [z for x in A for y in [*[x]] if t(0, y) for z in B])
show('not the short form: a set', lambda: [z for x in A for y in {x} if t(0, y) for z in B])
show('not the short form: two', lambda: [z for x in A for y in [x, x] if t(0, y) for z in B])
show('not the short form: none', lambda: [z for x in A for y in [] if t(0, y) for z in B])
show('not the short form: the first clause', lambda: [z for y in [1] if t(0, y) for z in B])
show('not the short form: a string', lambda: [z for x in A for y in 'a' if t(0, x) for z in B])

# What tools are told. For a trace function each clause and each condition is on a line of its own; for sys.monitoring all is on one line, and it is about the branches and the jumps.
CLAUSES = {'loop': 'for {v} in A', '[e]': 'for {v} in [{e}]', '(e,)': 'for {v} in ({e},)', '[e][:]': 'for {v} in [{e}][:]'}
FORMS = {'list': ('[', ']'), 'set': ('{', '}'), 'generator': ('sorted(', ')')}
def source(kinds, ifs, form, onOneLine=False):
    lines = []; names = []
    for i, (kind, count) in enumerate(zip(kinds, ifs)):
        v = 'x%d' % i
        e = '%s + %d' % (names[-1], i) if names else '1'
        lines.append(CLAUSES[kind].format(v=v, e=e))
        lines += ['if t(%d, %s)' % (10 * i + k, v) for k in range(count)]
        names.append(v)
    opening, closing = FORMS[form]
    if onOneLine:
        return 'def f():\n    r = %s%s %s%s\n    return r\n' % (opening, names[-1], ' '.join(lines), closing)
    return 'def f():\n    r = %s%s\n' % (opening, names[-1]) + ''.join('        %s\n' % l for l in lines[:-1]) + '        %s%s\n    return r\n' % (lines[-1], closing)
def conditions(n):
    yield (0,) * n
    yield (1,) * n
    for i in range(1, n):
        yield tuple(2 if j == i else 0 for j in range(n))
        yield tuple(1 if j == i else 0 for j in range(n))
M = sys.monitoring; E = M.events
def traced(f):
    ev = []
    def tr(frame, event, arg):
        if frame.f_code.co_filename != 'p': return None
        ev.append(event[0].upper() + str(frame.f_lineno)); return tr
    sys.settrace(tr)
    try: f()
    finally: sys.settrace(None)
    return ' '.join(ev)
def monitored(f):
    ev = []
    def lineof(code, offset):
        for a, b, l in code.co_lines():
            if a <= offset < b: return l
    def ours(code): return code.co_filename == 'p'
    M.use_tool_id(3, 'c3')
    M.register_callback(3, E.LINE, lambda code, line: ev.append('L%s' % line) if ours(code) else M.DISABLE)
    M.register_callback(3, E.JUMP, lambda code, a, b: ev.append('J%s>%s' % (lineof(code, a), lineof(code, b))) if ours(code) else M.DISABLE)
    M.register_callback(3, E.BRANCH_LEFT, lambda code, a, b: ev.append('bl%s>%s' % (lineof(code, a), lineof(code, b))) if ours(code) else M.DISABLE)
    M.register_callback(3, E.BRANCH_RIGHT, lambda code, a, b: ev.append('br%s>%s' % (lineof(code, a), lineof(code, b))) if ours(code) else M.DISABLE)
    M.set_events(3, E.LINE | E.JUMP | E.BRANCH_LEFT | E.BRANCH_RIGHT)
    try: f()
    finally:
        M.set_events(3, 0)
        for e in (E.LINE, E.JUMP, E.BRANCH_LEFT, E.BRANCH_RIGHT): M.register_callback(3, e, None)
        M.free_tool_id(3)
    return ' '.join(ev)
def rows():
    for n in (2, 3):
        for kinds in itertools.product(*([('loop',)] + [tuple(CLAUSES)] * (n - 1))):
            for ifs in conditions(n):
                for form in FORMS:
                    ns = {'t': t, 'A': A}
                    exec(compile(source(kinds, ifs, form), 'p', 'exec'), ns)
                    name = '%s %s %s' % (' '.join(kinds), ''.join(map(str, ifs)), form)
                    yield '%s settrace %s' % (name, traced(ns['f']))
                    exec(compile(source(kinds, ifs, form, True), 'p', 'exec'), ns)
                    yield '%s monitoring %s' % (name, monitored(ns['f']))
print('\n'.join(rows()))
