# The jump from the exit of an item of a `with` to the exit of the item before, which CPython has where its handlers are not laid out behind the rest of the function: as a tool of
# sys.monitoring is told of it.
import sys, warnings
warnings.simplefilter("ignore")
class M:
    def __enter__(self): return self
    def __exit__(self, *a): return False
class AM:
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
class E(Exception): pass
class Items:
    def __aiter__(self): return self
    async def __anext__(self): raise StopAsyncIteration
def c(v): return v
def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
W = {'one': 'with M():\n    x = 1', 'two': 'with M() as m, M():\n    x = 1', 'nested': 'with M():\n    with M():\n        x = 1',
     'three': 'with M(), M() as m, M():\n    x = 1', 'async two': 'async with AM() as m, AM():\n    x = 1', 'two, a test': 'with M() as m, M():\n    if (c(1) and\n        c(0)):\n        x = 1',
     'two, a loop': 'with M() as m, M():\n    for j in (1,):\n        x = 1', 'two, return': 'with M() as m, M():\n    return 1', 'two in one': 'with M():\n    with M() as m, M():\n        x = 1'}
TAIL = {'end': '', 'short': '\nx = 7', 'long': '\nx = c(7)\ny = c(8)\nz = c(9)\nreturn x + y + z'}
P = {'function': '%s', 'handler': 'try:\n    raise E\nexcept E:\n%s', 'async for else': 'async for i in Items():\n    pass\nelse:\n%s', 'behind async for': 'async for i in Items():\n    pass\n%s',
     'finally, exception': 'try:\n    try:\n        raise E\n    finally:\n%s\nexcept E:\n    pass', 'for else': 'for i in ():\n    pass\nelse:\n%s'}
mon = sys.monitoring; ev = mon.events; events = []
def line_of(code, offset):
    for s, e, l in code.co_lines():
        if s <= offset < e: return l
def on(name, n):
    def cb(code, *a):
        if code.co_filename != 'p': return mon.DISABLE
        events.append(name + ','.join(str(a[0] if name == 'L' else line_of(code, a[i])) for i in range(n)))
    return cb
WHAT = {ev.LINE: on('L', 1), ev.JUMP: on('J', 2)}
def main():
    for pn, p in P.items():
        for wn, w in W.items():
            for tn, t in TAIL.items():
                depth = {'function': 0, 'behind async for': 0, 'finally, exception': 8}.get(pn, 4)
                src = 'async def f():\n' + indent(p % indent(w, depth) + (t if pn != 'finally, exception' else '')) + '\n'
                if pn == 'finally, exception' and tn != 'end': continue
                g = dict(M=M, AM=AM, E=E, Items=Items, c=c); exec(compile(src, 'p', 'exec'), g)
                mon.use_tool_id(3, 't')
                for e, cb in WHAT.items(): mon.register_callback(3, e, cb)
                mon.set_events(3, sum(WHAT)); del events[:]
                try: g['f']().send(None)
                except StopIteration: pass
                mon.set_events(3, 0); mon.free_tool_id(3)
                print(pn, '|', wn, '|', tn, '|', ' '.join(events))
main()
