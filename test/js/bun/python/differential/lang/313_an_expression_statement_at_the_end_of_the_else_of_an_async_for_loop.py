# The line a coroutine returns on where its last statement is an expression statement in the `else` of an `async for` loop, as a trace function sees it: as behind a `for` loop.
import sys
def c(v): return v
class Items:
    def __init__(self, n): self.n = n
    def __aiter__(self): return self
    async def __anext__(self):
        if not self.n: raise StopAsyncIteration
        self.n -= 1; return self.n
def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
EXPRESSIONS = ['c(a)', 'a and c(1)', 'a or c(1)', '(a and\n    c(1))', '(a or\n    c(1))', 'c(1) if a else c(2)', '(c(1)\n    if a else\n    c(2))', '0 < c(a) < 2', '(0 < c(a) <\n    2)', 'a and b and c(1)', '(a and\n    b and\n    c(1))', 'not a']
LOOPS = {'no break': 'async for i in Items(N):\n    x = i\nelse:\n    E', 'break': 'async for i in Items(N):\n    if b: break\nelse:\n    E', 'for, no break': 'for i in range(N):\n    x = i\nelse:\n    E',
         'for, break': 'for i in range(N):\n    if b: break\nelse:\n    E'}
PLACES = {'alone': 'S', 'if': 'if c(1):\n    S', 'if else': 'if c(1):\n    S\nelse:\n    y = 1', 'try': 'try:\n    S\nexcept KeyError:\n    y = 1', 'with more behind': 'S\ny = 1', 'loop': 'for k in (1, 2):\n    S'}
def put(template, mark, what):
    return '\n'.join(indent(what, len(l) - len(l.lstrip())) if l.strip() == mark else l for l in template.split('\n'))
events = []
def trace(frame, event, arg):
    if frame.f_code.co_filename != 'p': return None
    events.append(event[0].upper() + str(frame.f_lineno)); return trace
for ln, loop in LOOPS.items():
    for e in EXPRESSIONS:
        for pn, place in PLACES.items():
            for n in (0, 2):
                source = 'async def f(a, b):\n' + indent(put(place, 'S', put(loop.replace('N', str(n)), 'E', e))) + '\n'
                g = {'c': c, 'Items': Items}; exec(compile(source, 'p', 'exec'), g)
                rows = []
                for args in ((0, 0), (0, 1), (1, 0), (1, 1)):
                    del events[:]; sys.settrace(trace)
                    try:
                        try: g['f'](*args).send(None)
                        except StopIteration: pass
                    finally: sys.settrace(None)
                    rows.append(' '.join(events))
                print(ln, '|', e.replace('\n', ' /'), '|', pn, '|', n, '|', ' ; '.join(rows))
