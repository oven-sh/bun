# The lines a trace function is told of where an expression is written over several lines: the subject of a `match`, what is raised and from what, what a comprehension goes through,
# tests that are conditional expressions, an `assert` at the end of a function.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try:
    def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def indent(t, n=4): return '\\n'.join(' ' * n + l for l in t.split('\\n'))")
try:
    class E(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(Exception): pass')
try:
    class F(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class F(Exception): pass')
try:
    def c(v): return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c(v): return v')
try: A = [1, 2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A = [1, 2]')
try: B = [3]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: B = [3]')
try: MATCH = ['match SUBJECT:\n    case 0:\n        x = 1\n    case _:\n        x = 2', 'match SUBJECT:\n    case [0, *r] | (0, *r):\n        x = 1\n    case v if c(b):\n        x = 2']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: MATCH = ['match SUBJECT:\\n case 0:\\n x = 1\\n case _:\\n x = 2', 'match...")
try: SUBJECTS = ['a', 'c(a)', '(\nc(a))', '(c(a)\n)', '(c(a)\nif b else c(2))', '(c(a) if b else\nc(2))', '(c(a)\nif b\nelse c(2))', '(a and\nb)', '(a or\nb)', '(\na and\nb\n)', 'c(\na)', '(a,\nb)', '[(\nc(a)\n), 1]', '[c(a),\n1]',
            '(c(a),\n0)[0]', '[c(a)\n][0]', '(not\na)', '(a +\nb)', '(\na +\nb)', '(lambda:\na)()', '\\\nc(a)', '(x := (\nc(a)))', '{"k":\na}', 'c(a).real', '(c(a)\n.real)', '(1 if a else\n2 if b else\n3)']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: SUBJECTS = ['a', 'c(a)', '(\\nc(a))', '(c(a)\\n)', '(c(a)\\nif b else c(...")
try: RAISE = ['raise E', 'raise E(1)', 'raise (\nE(1))', 'raise (E(1)\n)', 'raise \\\nE(1)', 'raise E(\n1)', 'raise (E if a else\nF)', 'raise (E\nif a else F)', 'raise (a and\nE(1)) or F(2)', 'raise (E(1) or\nb)', 'raise (a or\nE(1))',
         'raise (E(1),\n0)[0]', 'raise E(1) from None', 'raise E(1) from \\\nNone', 'raise E(1) from (\nF(2))', 'raise (E(1) or\nb) from None', 'raise (\nE(1)) from (\nF(2))', 'raise (E if a else\nF) from (F if b else\nE)']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: RAISE = ['raise E', 'raise E(1)', 'raise (\\nE(1))', 'raise (E(1)\\n)',...")
try: RAISE_IN_HANDLER = ['raise', 'if c(a): raise', 'if (c(a)\nif b else c(1)): raise', 'if (c(a) or\nb): raise', 'raise E(1) from e', 'raise E(1) from \\\ne', 'raise (E(1) or\nb) from e', 'raise (E(1) if a else\nF(2)) from e', 'raise (\nE(1)\n) from e',
                    'raise e', 'raise (\ne)', 'raise (e if a else\nF(1))']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: RAISE_IN_HANDLER = ['raise', 'if c(a): raise', 'if (c(a)\\nif b else c...")
try: ITERABLES = ['A', '(\nA)', '(\nc(1) and\nA\n)', '(a and\nA or B)', '(A\nif a else B)', '(A if a else\nB)', 'c(\nA)', '(A +\nB)', '[a,\nb]', '(c(A)\n)']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ITERABLES = ['A', '(\\nA)', '(\\nc(1) and\\nA\\n)', '(a and\\nA or B)', '(...")
try: COMPREHENSIONS = ['x = [y for y in ITER]', 'x = [y\n    for y in ITER]', 'x = [y for y in ITER if c(y)]', 'x = [y\n    for y in ITER\n    if c(y)]', 'x = {y for y in ITER}', 'x = {y: 1\n    for y in ITER}', 'x = sorted(y for y in ITER)',
                  'x = [(y,\n    z) for y in A for z in ITER]', '[y for y in ITER]', 'x = [(a or\n    y) for y in ITER]', 'for y in ITER:\n    x = y']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: COMPREHENSIONS = ['x = [y for y in ITER]', 'x = [y\\n for y in ITER]',...")
try: TESTS = ['((c(a) or\nb) if c(1) else c(0))', '((c(a) and\nb) if c(1) else c(0))', '((c(a) or\nb) if (\nc(1)) else c(0))', '(c(0) if c(0) else (c(a) or\nb))', '((not\nc(a)) if c(1) else c(0))', '((c(a) or b or\n0) if (1 and 1\nand c(b)) else c(1))',
         '((c(a) if b else\nc(1)) if c(1) else c(0))', '((c(a) or\nb) and c(1))', '(not (c(a) or\nb))', '(not ((c(a) or\nb) if c(1) else c(0)))', '((c(a) or\nb) if c(1) else (c(b) and\na))', '(((c(a) or\nb) and\nc(1)) if c(1) else c(0))']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: TESTS = ['((c(a) or\\nb) if c(1) else c(0))', '((c(a) and\\nb) if c(1) ...")
try: TESTED = ['if TEST:\n    x = 1\nx = 2', 'if TEST:\n    x = 1\nelse:\n    x = 2', 'while TEST:\n    x = 1\n    break\nx = 2', 'x = 1 if TEST else 2', 'x = [y for y in A if TEST]', 'assert TEST, c(1)\nx = 2', 'if c(0):\n    x = 0\nelif TEST:\n    x = 1']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: TESTED = ['if TEST:\\n x = 1\\nx = 2', 'if TEST:\\n x = 1\\nelse:\\n x = 2...")
try: ASSERTS = ['assert a', 'assert (a or\nb)', 'assert (a and\nb)', 'assert (\na)', 'assert (a if b else\n1)', 'assert (a\nif b else 1)', 'assert (a or\nb), c(1)', 'assert (a or\nb), (\nc(1))', 'assert (not\na)', 'assert (a or\nb or\n1)', 'assert (0 <\na + 1 <\n3)', 'assert c(\na)']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ASSERTS = ['assert a', 'assert (a or\\nb)', 'assert (a and\\nb)', 'asse...")
try: PLACES = {'function': 'S', 'if': 'if c(1):\n    S', 'else': 'if c(0):\n    x = 0\nelse:\n    S', 'loop': 'for i in A:\n    S', 'try': 'try:\n    S\nexcept F:\n    x = 9', 'with more behind': 'S\nz = 1', 'case': 'match 1:\n    case 1:\n        S',
          'finally': 'try:\n    x = 0\nfinally:\n    S'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: PLACES = {'function': 'S', 'if': 'if c(1):\\n S', 'else': 'if c(0):\\n ...")
try: HANDLER = 'try:\n    raise F(0)\nexcept F as e:\n    S'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: HANDLER = 'try:\\n raise F(0)\\nexcept F as e:\\n S'")
try:
    def put(place, statement):
        return '\n'.join(indent(statement, len(l) - 1) if l.strip() == 'S' else l for l in place.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def put(place, statement):')
try:
    def fill(template, word, expression):
        out = []
        for l in template.split('\n'):
            if word in l:
                base = len(l) - len(l.lstrip())
                l = l.replace(word, expression.replace('\n', '\n' + ' ' * (base + 4)))
            out.append(l)
        return '\n'.join(out)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fill(template, word, expression):')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def events(f, a, b):')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def statements():')
try:
    def rows():
        for statement, places in statements():
            for pn in places:
                source = 'def f(a, b):\n' + indent(put(PLACES[pn], statement)) + '\n'
                ns = {'c': c, 'E': E, 'F': F, 'A': A, 'B': B}
                exec(compile(source, 'p', 'exec'), ns)
                yield '%s | %s | %s' % (pn, statement.replace('\n', ' / '), ' ; '.join(events(ns['f'], a, b) for a in (0, 1) for b in (0, 1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rows():')
try: print('\n'.join(rows()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '\\n'.join(rows())")
