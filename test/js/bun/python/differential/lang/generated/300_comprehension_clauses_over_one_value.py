# Clauses of comprehensions over one value. `for y in [e]` is an assignment to CPython's compiler and to this one: there is no loop. Where a condition of such a clause fails, and behind
# a further clause, the loop around it goes on. `[z for x in a for y in [x] if y for z in b]` once jumped to where the loop of the clause would have begun, and never ended.
#
# First what comprehensions of two to four clauses make, by the kinds of the clauses, with up to two conditions at each; then such clauses in company; then what tools are told.
try: import sys, itertools, zlib
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, itertools, zlib')
try: LOG = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LOG = []')
try:
    def t(tag, v):
        LOG.append((tag, v))
        return (v + tag) % 3 != 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(tag, v):')
try: A = [1, 2, 3]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A = [1, 2, 3]')
try: CLAUSES = {
    'loop': 'for {v} in A',
    '[e]': 'for {v} in [{e}]',
    '(e,)': 'for {v} in ({e},)',
    '[e][:]': 'for {v} in [{e}][:]',
    '[*[e]]': 'for {v} in [*[{e}]]',
    '{e}': 'for {v} in {{{e}}}',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: CLAUSES = { 'loop': 'for {v} in A', '[e]': 'for {v} in [{e}]', '(e,)'...")
try: FORMS = {'list': '[{r} {c}]', 'set': 'sorted({{{r} {c}}})', 'dict': '{{{r}: 0 {c}}}', 'generator': 'list({r} {c})'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: FORMS = {'list': '[{r} {c}]', 'set': 'sorted({{{r} {c}}})', 'dict': '...")
try:
    def conditions(n):
        yield (0,) * n
        yield (1,) * n
        for i in range(n):
            for k in (1, 2) if n < 4 and i else (1,):
                yield tuple(k if j == i else 0 for j in range(n))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def conditions(n):')
try:
    def source(kinds, ifs, form):
        parts = []; names = []
        for i, (kind, count) in enumerate(zip(kinds, ifs)):
            v = 'x%d' % i
            e = '%s + %d' % (names[-1], i) if names else '1'
            parts.append(CLAUSES[kind].format(v=v, e=e) + ''.join(' if t(%d, %s)' % (10 * i + k, v) for k in range(count)))
            names.append(v)
        return FORMS[form].format(r='(' + ', '.join(names) + ',)', c=' '.join(parts))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def source(kinds, ifs, form):')
try:
    def rows():
        for n in (2, 3, 4):
            for kinds in itertools.product(*([('loop', '[e]')] + [tuple(CLAUSES) if n < 4 else ('loop', '[e]')] * (n - 1))):
                del LOG[:]
                values = eval('(' + ', '.join(source(kinds, ifs, form) for ifs in conditions(n) for form in FORMS) + ')')
                yield '%s: %d %08x' % (' '.join(kinds), sum(map(len, values)), zlib.crc32(repr((values, LOG)).encode()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rows():')
try: print('\n'.join(rows()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '\\n'.join(rows())")

# In company: a walrus, a lambda, other comprehensions, cells, classes, asynchronous clauses, exceptions.
try: B = [10, 20]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: B = [10, 20]')
try:
    class Agen:
        def __init__(self, values): self.values = list(values)
        def __aiter__(self): return self
        async def __anext__(self):
            if not self.values: raise StopAsyncIteration
            return self.values.pop(0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Agen:')
try:
    def run(coroutine):
        try:
            coroutine.send(None)
        except StopIteration as e:
            return e.value
        raise RuntimeError('it waits')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(coroutine):')
try:
    def show(name, function):
        del LOG[:]
        try:
            value = function()
        except Exception as e:
            value = '%s: %s' % (type(e).__name__, e)
        print(name, '|', value, '|', LOG)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(name, function):')

try: show('a condition, and a clause behind it', lambda: [z for x in A for y in [x] if y for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a condition, and a clause behind it', lambda: [z for x in A for...")
try: show('it fails for some', lambda: [z for x in A for y in [x] if y - 1 for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('it fails for some', lambda: [z for x in A for y in [x] if y - 1...")
try: show('two in a row', lambda: [(y, w, z) for x in A for y in [x] if t(0, y) for w in (y,) if t(1, w) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('two in a row', lambda: [(y, w, z) for x in A for y in [x] if t(...")
try: show('two in a row, the first without a condition', lambda: [(y, w, z) for x in A for y in [x] for w in (y,) if t(1, w) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('two in a row, the first without a condition', lambda: [(y, w, z...")
try: show('three in a row', lambda: [(y, w, v, z) for x in A for y in [x] if t(0, y) for w in [y + 1] if t(1, w) for v in [w + 1] if t(2, v) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('three in a row', lambda: [(y, w, v, z) for x in A for y in [x] ...")
try: show('last', lambda: [y for x in A for z in B for y in [x + z] if t(0, y)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('last', lambda: [y for x in A for z in B for y in [x + z] if t(0...")
try: show('walrus', lambda: [(y, k, z) for x in A for y in [x] if (k := t(0, y)) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('walrus', lambda: [(y, k, z) for x in A for y in [x] if (k := t(...")
try: show('lambda', lambda: [z for x in A for y in [x] if (lambda: t(0, y))() for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('lambda', lambda: [z for x in A for y in [x] if (lambda: t(0, y)...")
try: show('lambdas made', lambda: [f() for f in [(lambda: (y, z)) for x in A for y in [x] if t(0, y) for z in B]])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('lambdas made', lambda: [f() for f in [(lambda: (y, z)) for x in...")
try: show('and', lambda: [z for x in A for y in [x] if t(0, y) and t(1, y) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('and', lambda: [z for x in A for y in [x] if t(0, y) and t(1, y)...")
try: show('or', lambda: [z for x in A for y in [x] if t(0, y) or t(1, y) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('or', lambda: [z for x in A for y in [x] if t(0, y) or t(1, y) f...")
try: show('not', lambda: [z for x in A for y in [x] if not t(0, y) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('not', lambda: [z for x in A for y in [x] if not t(0, y) for z i...")
try: show('conditional expression', lambda: [z for x in A for y in [x] if (t(0, y) if t(1, y) else t(2, y)) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('conditional expression', lambda: [z for x in A for y in [x] if ...")
try: show('a chain', lambda: [z for x in A for y in [x] if 0 < y < 3 for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a chain', lambda: [z for x in A for y in [x] if 0 < y < 3 for z...")
try: show('always', lambda: [z for x in A for y in [x] if 1 for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('always', lambda: [z for x in A for y in [x] if 1 for z in B])")
try: show('never', lambda: [z for x in A for y in [x] if 0 for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('never', lambda: [z for x in A for y in [x] if 0 for z in B])")
try: show('never, then a condition', lambda: [z for x in A for y in [x] if 0 if t(0, y) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('never, then a condition', lambda: [z for x in A for y in [x] if...")
try: show('is None', lambda: [z for x in A for y in [None] if y is None for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('is None', lambda: [z for x in A for y in [None] if y is None fo...")
try: show('is not None', lambda: [z for x in A for y in [None] if y is not None for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('is not None', lambda: [z for x in A for y in [None] if y is not...")
try: show('a comprehension in the value', lambda: [z for x in A for y in [[w for w in A if t(0, w)]] if y for z in y])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a comprehension in the value', lambda: [z for x in A for y in [...")
try: show('a comprehension in the condition', lambda: [z for x in A for y in [x] if [w for v in A for w in [v] if t(0, w) for u in B] for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a comprehension in the condition', lambda: [z for x in A for y ...")
try: show('a comprehension is the element', lambda: [[(y, w) for v in B for w in [v] if t(1, w) for u in A] for x in A for y in [x] if t(0, y) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a comprehension is the element', lambda: [[(y, w) for v in B fo...")
try: show('the same name', lambda: [x for x in A for x in [x + 1] if t(0, x) for x in [x, x + 1]])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('the same name', lambda: [x for x in A for x in [x + 1] if t(0, ...")
try: show('unpacking', lambda: [(p, q, z) for x in A for p, q in [(x, x + 1)] if t(0, q) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('unpacking', lambda: [(p, q, z) for x in A for p, q in [(x, x + ...")
try: show('a starred target', lambda: [(p, q, z) for x in A for p, *q in [(x, x + 1, x + 2)] if t(0, p) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a starred target', lambda: [(p, q, z) for x in A for p, *q in [...")
try: show('an attribute is the target', lambda: [(t.y, z) for x in A for t.y in [x] if t(0, t.y) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('an attribute is the target', lambda: [(t.y, z) for x in A for t...")
try: show('it raises in the condition', lambda: [z for x in A for y in [x] if 1 // (y - 2) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('it raises in the condition', lambda: [z for x in A for y in [x]...")
try: show('it raises in the value', lambda: [z for x in A for y in [1 // (x - 2)] if y for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('it raises in the value', lambda: [z for x in A for y in [1 // (...")
try: show('set', lambda: sorted({z + y for x in A for y in [x] if t(0, y) for z in B}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('set', lambda: sorted({z + y for x in A for y in [x] if t(0, y) ...")
try: show('dict', lambda: {y: z for x in A for y in [x] if t(0, y) for z in B})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('dict', lambda: {y: z for x in A for y in [x] if t(0, y) for z i...")
try: show('generator', lambda: list(z for x in A for y in [x] if t(0, y) for z in B))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('generator', lambda: list(z for x in A for y in [x] if t(0, y) f...")
try: show('sum of a generator', lambda: sum(z for x in A for y in [x] if t(0, y) for z in B))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('sum of a generator', lambda: sum(z for x in A for y in [x] if t...")
try:
    def closed():
        g = ((y, z) for x in A for y in [x] if t(0, y) for z in B)
        first = next(g); g.close()
        return first, list(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def closed():')
try: show('a generator that is closed', closed)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a generator that is closed', closed)")
try:
    class K:
        values = [z for x in [1, 2, 3] for y in [x] if y - 1 for z in [10, 20]]
        names = sorted(n for n in dir() if not n.startswith('_'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K:')
try: show('in a class', lambda: (K.values, K.names))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('in a class', lambda: (K.values, K.names))")
try: show('at the top of a module', lambda: eval(compile('[z for x in A for y in [x] if t(0, y) for z in B]', 'm', 'eval')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('at the top of a module', lambda: eval(compile('[z for x in A fo...")
try:
    def local():
        y = 'outside'; z = 'outside'
        r = [z for x in A for y in [x] if t(0, y) for z in B]
        return r, y, z
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def local():')
try: show('the variables outside', local)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('the variables outside', local)")
try:
    def cells():
        y = 'outside'
        r = [(lambda: y) for x in A for y in [x] if t(0, y) for z in B]
        return [f() for f in r], y
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cells():')
try: show('cells', cells)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('cells', cells)")
try:
    async def around():
        return [z async for x in Agen(A) for y in [x] if t(0, y) for z in B]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def around():')
try: show('async for around it', lambda: run(around()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('async for around it', lambda: run(around()))")
try:
    async def behind():
        return [z for x in A for y in [x] if t(0, y) async for z in Agen(B)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def behind():')
try: show('async for behind it', lambda: run(behind()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('async for behind it', lambda: run(behind()))")
try:
    async def both():
        return [(w, z) async for x in Agen(A) for y in [x] if t(0, y) async for z in Agen(B) for w in (z + y,) if t(1, w) for v in A]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def both():')
try: show('async for around it and behind it', lambda: run(both()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('async for around it and behind it', lambda: run(both()))")
try:
    async def awaited():
        async def c(v): return t(0, v)
        return [z for x in A for y in [x] if await c(y) for z in B]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def awaited():')
try: show('await in the condition', lambda: run(awaited()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('await in the condition', lambda: run(awaited()))")
try:
    async def agen():
        g = (z async for x in Agen(A) for y in [x] if t(0, y) for z in B)
        return [v async for v in g]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def agen():')
try: show('an asynchronous generator expression', lambda: run(agen()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('an asynchronous generator expression', lambda: run(agen()))")
try: show('not the short form: a slice', lambda: [z for x in A for y in [x][:] if t(0, y) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('not the short form: a slice', lambda: [z for x in A for y in [x...")
try: show('not the short form: starred', lambda: [z for x in A for y in [*[x]] if t(0, y) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('not the short form: starred', lambda: [z for x in A for y in [*...")
try: show('not the short form: a set', lambda: [z for x in A for y in {x} if t(0, y) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('not the short form: a set', lambda: [z for x in A for y in {x} ...")
try: show('not the short form: two', lambda: [z for x in A for y in [x, x] if t(0, y) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('not the short form: two', lambda: [z for x in A for y in [x, x]...")
try: show('not the short form: none', lambda: [z for x in A for y in [] if t(0, y) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('not the short form: none', lambda: [z for x in A for y in [] if...")
try: show('not the short form: the first clause', lambda: [z for y in [1] if t(0, y) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('not the short form: the first clause', lambda: [z for y in [1] ...")
try: show('not the short form: a string', lambda: [z for x in A for y in 'a' if t(0, x) for z in B])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('not the short form: a string', lambda: [z for x in A for y in '...")

# What tools are told. For a trace function each clause and each condition is on a line of its own; for sys.monitoring all is on one line, and it is about the branches and the jumps.
try: CLAUSES = {'loop': 'for {v} in A', '[e]': 'for {v} in [{e}]', '(e,)': 'for {v} in ({e},)', '[e][:]': 'for {v} in [{e}][:]'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: CLAUSES = {'loop': 'for {v} in A', '[e]': 'for {v} in [{e}]', '(e,)':...")
try: FORMS = {'list': ('[', ']'), 'set': ('{', '}'), 'generator': ('sorted(', ')')}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: FORMS = {'list': ('[', ']'), 'set': ('{', '}'), 'generator': ('sorted...")
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def source(kinds, ifs, form, onOneLine=False):')
try:
    def conditions(n):
        yield (0,) * n
        yield (1,) * n
        for i in range(1, n):
            yield tuple(2 if j == i else 0 for j in range(n))
            yield tuple(1 if j == i else 0 for j in range(n))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def conditions(n):')
try: M = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M = sys.monitoring')
try: E = M.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E = M.events')
try:
    def traced(f):
        ev = []
        def tr(frame, event, arg):
            if frame.f_code.co_filename != 'p': return None
            ev.append(event[0].upper() + str(frame.f_lineno)); return tr
        sys.settrace(tr)
        try: f()
        finally: sys.settrace(None)
        return ' '.join(ev)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def traced(f):')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def monitored(f):')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rows():')
try: print('\n'.join(rows()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '\\n'.join(rows())")
