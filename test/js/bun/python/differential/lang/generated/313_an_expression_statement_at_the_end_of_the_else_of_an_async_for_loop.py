# The line a coroutine returns on where its last statement is an expression statement in the `else` of an `async for` loop, as a trace function sees it: as behind a `for` loop.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try:
    def c(v): return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c(v): return v')
try:
    class Items:
        def __init__(self, n): self.n = n
        def __aiter__(self): return self
        async def __anext__(self):
            if not self.n: raise StopAsyncIteration
            self.n -= 1; return self.n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Items:')
try:
    def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def indent(t, n=4): return '\\n'.join(' ' * n + l for l in t.split('\\n'))")
try: EXPRESSIONS = ['c(a)', 'a and c(1)', 'a or c(1)', '(a and\n    c(1))', '(a or\n    c(1))', 'c(1) if a else c(2)', '(c(1)\n    if a else\n    c(2))', '0 < c(a) < 2', '(0 < c(a) <\n    2)', 'a and b and c(1)', '(a and\n    b and\n    c(1))', 'not a']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: EXPRESSIONS = ['c(a)', 'a and c(1)', 'a or c(1)', '(a and\\n c(1))', '...")
try: LOOPS = {'no break': 'async for i in Items(N):\n    x = i\nelse:\n    E', 'break': 'async for i in Items(N):\n    if b: break\nelse:\n    E', 'for, no break': 'for i in range(N):\n    x = i\nelse:\n    E',
         'for, break': 'for i in range(N):\n    if b: break\nelse:\n    E'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: LOOPS = {'no break': 'async for i in Items(N):\\n x = i\\nelse:\\n E', '...")
try: PLACES = {'alone': 'S', 'if': 'if c(1):\n    S', 'if else': 'if c(1):\n    S\nelse:\n    y = 1', 'try': 'try:\n    S\nexcept KeyError:\n    y = 1', 'with more behind': 'S\ny = 1', 'loop': 'for k in (1, 2):\n    S'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: PLACES = {'alone': 'S', 'if': 'if c(1):\\n S', 'if else': 'if c(1):\\n ...")
try:
    def put(template, mark, what):
        return '\n'.join(indent(what, len(l) - len(l.lstrip())) if l.strip() == mark else l for l in template.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def put(template, mark, what):')
try: events = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: events = []')
try:
    def trace(frame, event, arg):
        if frame.f_code.co_filename != 'p': return None
        events.append(event[0].upper() + str(frame.f_lineno)); return trace
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def trace(frame, event, arg):')
try:
    for ln, loop in LOOPS.items():
        for e in EXPRESSIONS:
            for pn, place in PLACES.items():
                for n in (0, 2):
                    try: source = 'async def f(a, b):\n' + indent(put(place, 'S', put(loop.replace('N', str(n)), 'E', e))) + '\n'
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: source = 'async def f(a, b):\\n' + indent(put(place, 'S', put(loop.rep...")
                    try: g = {'c': c, 'Items': Items}
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: g = {'c': c, 'Items': Items}")
                    try: exec(compile(source, 'p', 'exec'), g)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec(compile(source, 'p', 'exec'), g)")
                    try: rows = []
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: rows = []')
                    for args in ((0, 0), (0, 1), (1, 0), (1, 1)):
                        try: del events[:]
                        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del events[:]')
                        try: sys.settrace(trace)
                        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(trace)')
                        try:
                            try: g['f'](*args).send(None)
                            except StopIteration: pass
                        finally: sys.settrace(None)
                        try: rows.append(' '.join(events))
                        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: rows.append(' '.join(events))")
                    try: print('ln [' + 'ln=' + (repr(ln) if type(ln) in (str, int, float, bytes, bool, type(None)) or (type(ln) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in ln)) else ln.__name__ if type(ln) is type else type(ln).__name__) + ", " + 'loop=' + (repr(loop) if type(loop) in (str, int, float, bytes, bool, type(None)) or (type(loop) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in loop)) else loop.__name__ if type(loop) is type else type(loop).__name__) + ", " + 'e=' + (repr(e) if type(e) in (str, int, float, bytes, bool, type(None)) or (type(e) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in e)) else e.__name__ if type(e) is type else type(e).__name__) + ", " + 'pn=' + (repr(pn) if type(pn) in (str, int, float, bytes, bool, type(None)) or (type(pn) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in pn)) else pn.__name__ if type(pn) is type else type(pn).__name__) + ", " + 'place=' + (repr(place) if type(place) in (str, int, float, bytes, bool, type(None)) or (type(place) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in place)) else place.__name__ if type(place) is type else type(place).__name__) + ", " + 'n=' + (repr(n) if type(n) in (str, int, float, bytes, bool, type(None)) or (type(n) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in n)) else n.__name__ if type(n) is type else type(n).__name__) + '] =>', ln)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ln')
                    try: print('|', "e.replace('\\n', ' /') [" + 'ln=' + (repr(ln) if type(ln) in (str, int, float, bytes, bool, type(None)) or (type(ln) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in ln)) else ln.__name__ if type(ln) is type else type(ln).__name__) + ", " + 'loop=' + (repr(loop) if type(loop) in (str, int, float, bytes, bool, type(None)) or (type(loop) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in loop)) else loop.__name__ if type(loop) is type else type(loop).__name__) + ", " + 'e=' + (repr(e) if type(e) in (str, int, float, bytes, bool, type(None)) or (type(e) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in e)) else e.__name__ if type(e) is type else type(e).__name__) + ", " + 'pn=' + (repr(pn) if type(pn) in (str, int, float, bytes, bool, type(None)) or (type(pn) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in pn)) else pn.__name__ if type(pn) is type else type(pn).__name__) + ", " + 'place=' + (repr(place) if type(place) in (str, int, float, bytes, bool, type(None)) or (type(place) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in place)) else place.__name__ if type(place) is type else type(place).__name__) + ", " + 'n=' + (repr(n) if type(n) in (str, int, float, bytes, bool, type(None)) or (type(n) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in n)) else n.__name__ if type(n) is type else type(n).__name__) + '] =>', e.replace('\n', ' /'))
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: e.replace('\\n', ' /')")
                    try: print('|', 'pn [' + 'ln=' + (repr(ln) if type(ln) in (str, int, float, bytes, bool, type(None)) or (type(ln) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in ln)) else ln.__name__ if type(ln) is type else type(ln).__name__) + ", " + 'loop=' + (repr(loop) if type(loop) in (str, int, float, bytes, bool, type(None)) or (type(loop) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in loop)) else loop.__name__ if type(loop) is type else type(loop).__name__) + ", " + 'e=' + (repr(e) if type(e) in (str, int, float, bytes, bool, type(None)) or (type(e) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in e)) else e.__name__ if type(e) is type else type(e).__name__) + ", " + 'pn=' + (repr(pn) if type(pn) in (str, int, float, bytes, bool, type(None)) or (type(pn) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in pn)) else pn.__name__ if type(pn) is type else type(pn).__name__) + ", " + 'place=' + (repr(place) if type(place) in (str, int, float, bytes, bool, type(None)) or (type(place) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in place)) else place.__name__ if type(place) is type else type(place).__name__) + ", " + 'n=' + (repr(n) if type(n) in (str, int, float, bytes, bool, type(None)) or (type(n) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in n)) else n.__name__ if type(n) is type else type(n).__name__) + '] =>', pn)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pn')
                    try: print('|', 'n [' + 'ln=' + (repr(ln) if type(ln) in (str, int, float, bytes, bool, type(None)) or (type(ln) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in ln)) else ln.__name__ if type(ln) is type else type(ln).__name__) + ", " + 'loop=' + (repr(loop) if type(loop) in (str, int, float, bytes, bool, type(None)) or (type(loop) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in loop)) else loop.__name__ if type(loop) is type else type(loop).__name__) + ", " + 'e=' + (repr(e) if type(e) in (str, int, float, bytes, bool, type(None)) or (type(e) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in e)) else e.__name__ if type(e) is type else type(e).__name__) + ", " + 'pn=' + (repr(pn) if type(pn) in (str, int, float, bytes, bool, type(None)) or (type(pn) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in pn)) else pn.__name__ if type(pn) is type else type(pn).__name__) + ", " + 'place=' + (repr(place) if type(place) in (str, int, float, bytes, bool, type(None)) or (type(place) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in place)) else place.__name__ if type(place) is type else type(place).__name__) + ", " + 'n=' + (repr(n) if type(n) in (str, int, float, bytes, bool, type(None)) or (type(n) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in n)) else n.__name__ if type(n) is type else type(n).__name__) + '] =>', n)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n')
                    try: print('|', "' ; '.join(rows) [" + 'ln=' + (repr(ln) if type(ln) in (str, int, float, bytes, bool, type(None)) or (type(ln) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in ln)) else ln.__name__ if type(ln) is type else type(ln).__name__) + ", " + 'loop=' + (repr(loop) if type(loop) in (str, int, float, bytes, bool, type(None)) or (type(loop) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in loop)) else loop.__name__ if type(loop) is type else type(loop).__name__) + ", " + 'e=' + (repr(e) if type(e) in (str, int, float, bytes, bool, type(None)) or (type(e) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in e)) else e.__name__ if type(e) is type else type(e).__name__) + ", " + 'pn=' + (repr(pn) if type(pn) in (str, int, float, bytes, bool, type(None)) or (type(pn) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in pn)) else pn.__name__ if type(pn) is type else type(pn).__name__) + ", " + 'place=' + (repr(place) if type(place) in (str, int, float, bytes, bool, type(None)) or (type(place) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in place)) else place.__name__ if type(place) is type else type(place).__name__) + ", " + 'n=' + (repr(n) if type(n) in (str, int, float, bytes, bool, type(None)) or (type(n) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in n)) else n.__name__ if type(n) is type else type(n).__name__) + '] =>', ' ; '.join(rows))
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ' ; '.join(rows)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for ln, loop in LOOPS.items():')
