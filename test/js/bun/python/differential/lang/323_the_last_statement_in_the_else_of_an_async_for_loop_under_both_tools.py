# The last statement of a coroutine in the `else` of an `async for` loop, of every kind: the lines as a trace function and as a tool of sys.monitoring see them, as behind a `for` loop.
import sys
def c(v): return v
class E(Exception): pass
class M:
    def __enter__(self): return self
    def __exit__(self, *a): return False
class Items:
    def __init__(self, n): self.n = n
    def __aiter__(self): return self
    async def __anext__(self):
        if not self.n: raise StopAsyncIteration
        self.n -= 1; return self.n
def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
STATEMENTS = ['c(a)', 'y = c(a)', 'y = a and c(1)', 'pass', 'return', 'return c(a)', 'return 5', 'if a: y = 1', 'if a:\n    y = 1', 'if a:\n    y = 1\nelse:\n    y = 2', 'if a:\n    y = 1\nelif b:\n    y = 2',
              'while c(0):\n    y = 1', 'for j in (1,):\n    y = j', 'for j in (1,):\n    if a: break\nelse:\n    y = 2', 'with M():\n    y = 1', 'with M():\n    c(a)', 'try:\n    y = 1\nfinally:\n    y = 2',
              'try:\n    c(a)\nexcept E:\n    y = 2', 'try:\n    if a: raise E\nexcept E as e:\n    y = 2', 'try:\n    if a: raise E\nexcept E:\n    c(a)\nelse:\n    c(b)', 'match a:\n    case 1:\n        y = 1\n    case _:\n        y = 2',
              'match a:\n    case 1:\n        y = 1', 'assert c(1)', 'assert (a or\n    c(1))', 'del a', 'global z; z = 1', 'y = [k for k in (1, 2)]', 'y = all(k for k in (1, 2))', 'import sys', 'def h(): pass', 'class H: pass',
              'y: int = a', 'y += a' , 'async for j in Items(1):\n    y = j', 'async for j in Items(1):\n    y = j\nelse:\n    c(a)', 'await K()', 'y = await K()', 'lambda: 0', '"s"', '...']
LOOPS = {'no break': 'async for i in Items(N):\n    x = i\nelse:\n    S', 'break': 'async for i in Items(N):\n    if b: break\nelse:\n    S',
         'for, break': 'for i in range(N):\n    if b: break\nelse:\n    S'}
PLACES = {'alone': 'L', 'more behind': 'L\ny = 1', 'loop': 'for k in (1,):\n    L'}
class K:
    def __await__(self): return iter(())
def put(template, mark, what):
    return '\n'.join(indent(what, len(l) - len(l.lstrip())) if l.strip() == mark else l for l in template.split('\n'))
events = []
def trace(frame, event, arg):
    if frame.f_code.co_filename != 'p': return None
    events.append(event[0].upper() + str(frame.f_lineno)); return trace
mon = sys.monitoring; ev = mon.events; TOOL = 3
def line_of(code, offset):
    for start, end, line in code.co_lines():
        if start <= offset < end: return line
def on(name, places):
    def callback(code, *a):
        if code.co_filename != 'p': return mon.DISABLE
        events.append(name + ','.join(str(a[0] if name == 'L' else line_of(code, a[i])) for i in range(places)))
    return callback
WHAT = {ev.LINE: on('L', 1), ev.PY_RETURN: on('R', 1), ev.JUMP: on('J', 2), ev.BRANCH_LEFT: on('<', 2), ev.BRANCH_RIGHT: on('>', 2), ev.PY_START: on('S', 0)}
def same(rows): return ' ; '.join('=' if i and r == rows[i - 1] else r for i, r in enumerate(rows))
def run(f, args):
    try: f(*args).send(None)
    except StopIteration: pass
    except BaseException as e: events.append(type(e).__name__)
def main():
    for ln, loop in LOOPS.items():
        for s in STATEMENTS:
            for pn, place in PLACES.items():
                for n in (0, 1) if 'no break' not in ln else (0,):
                    source = 'async def f(a, b):\n' + indent(put(place, 'L', put(loop.replace('N', str(n)), 'S', s))) + '\n'
                    g = {'c': c, 'Items': Items, 'E': E, 'M': M, 'K': K}; exec(compile(source, 'p', 'exec'), g)
                    rows = []
                    for args in ((0, 0), (0, 1), (1, 0), (1, 1)):
                        del events[:]; sys.settrace(trace)
                        try: run(g['f'], args)
                        finally: sys.settrace(None)
                        rows.append(' '.join(events))
                    print(ln, '|', s.replace('\n', ' /'), '|', pn, '|', n, '| trace |', same(rows))
                    # Not as in CPython yet: the jump behind a comprehension; and where the branch out of a `while` or an `assert` leads if more comes behind the `async for`: the next line there, and here still the line of the test.
                    if ' for k in ' in s or (pn == 'more behind' and not ln.startswith('for') and s.startswith(('while', 'assert c'))): continue
                    rows = []
                    mon.use_tool_id(TOOL, 't')
                    for e, cb in WHAT.items(): mon.register_callback(TOOL, e, cb)
                    mon.set_events(TOOL, sum(WHAT))
                    for args in ((0, 0), (0, 1), (1, 0), (1, 1)):
                        del events[:]
                        run(g['f'], args)
                        rows.append(' '.join(events))
                    mon.set_events(TOOL, 0); mon.free_tool_id(TOOL)
                    print(ln, '|', s.replace('\n', ' /'), '|', pn, '|', n, '| tool |', same(rows))
main()
