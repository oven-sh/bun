# No trace function. How long the value of a `return` lives where more than a `finally` clause runs on the way out, and the clause may never hand it on.
import gc, weakref, itertools, warnings
warnings.simplefilter("ignore")
class C:
    def __enter__(s): return s
    def __exit__(s, *a): seen.append(('exit', alive())); return False
    async def __aenter__(s): return s
    async def __aexit__(s, *a):
        seen.append(('aexit', alive())); await K(); seen.append(('aexit 2', alive())); return False
class K:
    def __await__(s): yield 'k'
def alive():
    gc.collect()
    return W() is not None
def make():
    global W
    o = C(); W = weakref.ref(o)
    return o
def p(): seen.append(alive()); return True
def items():
    try: yield 1; yield 2
    finally: seen.append(('closed', alive()))
WAYS = {'with': 'with C():\n    return make()', 'loop': 'for i in items():\n    return make()', 'handler': 'try:\n    raise KeyError\nexcept KeyError as e:\n    return make()',
        'inner clause': 'try:\n    return make()\nfinally:\n    p()', 'plain': 'return make()', 'async with': 'async with C():\n    return make()',
        'async with in with': 'with C():\n    async with C():\n        return make()', 'inner clause that awaits': 'try:\n    return make()\nfinally:\n    await K()\n    p()'}
ENDS = {'return': 'return 5', 'break': 'break', 'continue': 'continue', 'raise': 'raise IndexError', 'goes on': 'p()', 'await, return': 'await K()\np()\nreturn 5'}
def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
for (wn, way), (en, end), outer in itertools.product(WAYS.items(), ENDS.items(), ('', 'clause')):
    body = 'try:\n' + indent(way) + '\nfinally:\n    p()\n' + indent(end)
    if end in ('break', 'continue'): body = 'for k in (1, 2):\n' + indent(body) + '\np()'
    if outer == 'clause': body = 'try:\n' + indent(body) + '\nfinally:\n    p()'
    ns = dict(globals())
    exec('async def f():\n' + indent(body), ns)
    seen = []
    r = ns['f']()
    try:
        while True:
            r.send(None); seen.append(('suspended', alive()))
    except StopIteration as e: r = type(e.value).__name__
    except IndexError: r = 'IndexError'
    seen.append(('after', alive()))
    print(wn, '|', en, '|', outer, '|', seen, r)
