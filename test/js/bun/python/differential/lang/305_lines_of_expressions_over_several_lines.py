# The lines a trace function is told of where an expression is written over several lines: the subject of a `match`, what is raised and from what, what a comprehension goes through,
# tests that are conditional expressions, an `assert` at the end of a function.
import sys
def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
class E(Exception): pass
class F(Exception): pass
def c(v): return v
A = [1, 2]; B = [3]
MATCH = ['match SUBJECT:\n    case 0:\n        x = 1\n    case _:\n        x = 2', 'match SUBJECT:\n    case [0, *r] | (0, *r):\n        x = 1\n    case v if c(b):\n        x = 2']
SUBJECTS = ['a', 'c(a)', '(\nc(a))', '(c(a)\n)', '(c(a) if b else\nc(2))', '(a and\nb)', '(a or\nb)', '(\na and\nb\n)', 'c(\na)', '(a,\nb)', '[c(a),\n1]', '(c(a),\n0)[0]', '[c(a)\n][0]', '(a +\nb)',
            '(\na +\nb)', '(lambda:\na)()', '\\\nc(a)', '{"k":\na}', 'c(a).real', '(c(a)\n.real)', '(1 if a else\n2 if b else\n3)']
RAISE = ['raise E', 'raise E(1)', 'raise (\nE(1))', 'raise (E(1)\n)', 'raise \\\nE(1)', 'raise E(\n1)', 'raise (E if a else\nF)', 'raise (E\nif a else F)', 'raise (a and\nE(1)) or F(2)', 'raise (E(1) or\nb)', 'raise (a or\nE(1))',
         'raise (E(1),\n0)[0]', 'raise E(1) from None', 'raise E(1) from \\\nNone', 'raise E(1) from (\nF(2))', 'raise (E(1) or\nb) from None', 'raise (\nE(1)) from (\nF(2))', 'raise (E if a else\nF) from (F if b else\nE)']
RAISE_IN_HANDLER = ['raise', 'if c(a): raise', 'if (c(a)\nif b else c(1)): raise', 'if (c(a) or\nb): raise', 'raise E(1) from e', 'raise E(1) from \\\ne', 'raise (E(1) or\nb) from e', 'raise (E(1) if a else\nF(2)) from e', 'raise (\nE(1)\n) from e',
                    'raise e', 'raise (\ne)', 'raise (e if a else\nF(1))']
ITERABLES = ['A', '(\nA)', '(\nc(1) and\nA\n)', '(a and\nA or B)', '(A\nif a else B)', '(A if a else\nB)', 'c(\nA)', '(A +\nB)', '[a,\nb]', '(c(A)\n)']
COMPREHENSIONS = ['x = [y for y in ITER]', 'x = [y\n    for y in ITER]', 'x = [y for y in ITER if c(y)]', 'x = [y\n    for y in ITER\n    if c(y)]', 'x = {y for y in ITER}', 'x = {y: 1\n    for y in ITER}', 'x = sorted(y for y in ITER)',
                  'x = [(y,\n    z) for y in A for z in ITER]', '[y for y in ITER]', 'x = [(a or\n    y) for y in ITER]', 'for y in ITER:\n    x = y']
TESTS = ['(c(0) if c(0) else (c(a) or\nb))', '((not\nc(a)) if c(1) else c(0))', '((c(a) if b else\nc(1)) if c(1) else c(0))', '((c(a) or\nb) and c(1))', '(not (c(a) or\nb))']
TESTED = ['if TEST:\n    x = 1\nx = 2', 'if TEST:\n    x = 1\nelse:\n    x = 2', 'while TEST:\n    x = 1\n    break\nx = 2', 'x = 1 if TEST else 2', 'x = [y for y in A if TEST]', 'assert TEST, c(1)\nx = 2', 'if c(0):\n    x = 0\nelif TEST:\n    x = 1']
ASSERTS = ['assert a', 'assert (a or\nb)', 'assert (a and\nb)', 'assert (\na)', 'assert (a if b else\n1)', 'assert (a\nif b else 1)', 'assert (a or\nb), c(1)', 'assert (a or\nb), (\nc(1))', 'assert (not\na)', 'assert (a or\nb or\n1)', 'assert (0 <\na + 1 <\n3)', 'assert c(\na)']
PLACES = {'function': 'S', 'if': 'if c(1):\n    S', 'else': 'if c(0):\n    x = 0\nelse:\n    S', 'loop': 'for i in A:\n    S', 'try': 'try:\n    S\nexcept F:\n    x = 9', 'with more behind': 'S\nz = 1', 'case': 'match 1:\n    case 1:\n        S',
          'finally': 'try:\n    x = 0\nfinally:\n    S'}
HANDLER = 'try:\n    raise F(0)\nexcept F as e:\n    S'
def put(place, statement):
    return '\n'.join(indent(statement, len(l) - 1) if l.strip() == 'S' else l for l in place.split('\n'))
def fill(template, word, expression):
    out = []
    for l in template.split('\n'):
        if word in l:
            base = len(l) - len(l.lstrip())
            l = l.replace(word, expression.replace('\n', '\n' + ' ' * (base + 4)))
        out.append(l)
    return '\n'.join(out)
def events(f, a, b):
    ev = []
    def tr(frame, event, arg):
        if frame.f_code.co_filename != 'p': return None
        ev.append(event[0].upper() + str(frame.f_lineno)); return tr
    sys.settrace(tr)
    try: f(a, b)
    except Exception as e: ev.append(type(e).__name__)
    finally: sys.settrace(None)
    return ' '.join(ev)
def statements():
    for m in MATCH:
        for s in SUBJECTS: yield fill(m, 'SUBJECT', s), PLACES
    for r in RAISE: yield r, PLACES
    for r in RAISE_IN_HANDLER: yield put(HANDLER, r), PLACES
    for k in COMPREHENSIONS:
        for i in ITERABLES: yield fill(k, 'ITER', i), ('function', 'loop', 'try')
    for t in TESTED:
        for e in TESTS:
            if not (t.startswith('x = [') and e.startswith('((c(a) if b')): yield fill(t, 'TEST', e), ('function', 'loop', 'else')
    for s in ASSERTS: yield s, PLACES
def rows():
    for statement, places in statements():
        for pn in places:
            source = 'def f(a, b):\n' + indent(put(PLACES[pn], statement)) + '\n'
            ns = {'c': c, 'E': E, 'F': F, 'A': A, 'B': B}
            exec(compile(source, 'p', 'exec'), ns)
            yield '%s | %s | %s' % (pn, statement.replace('\n', ' / '), ' ; '.join(events(ns['f'], a, b) for a in (0, 1) for b in (0, 1)))
print('\n'.join(rows()))
