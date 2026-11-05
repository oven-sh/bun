# Where a `for` loop ends, CPython drops the iterator, and that is no news of a line. Nor does it count as the instruction before the next one: if what
# is laid out in front of it is of the same line as what follows, which is so when a `return` in the loop has left a `with` statement, no line
# begins there, and nobody is told of the line of the `with` when the loop has run out.
import asyncio, sys

PRELUDE = '''
class CM:
    def __enter__(self): return [1, 2]
    def __exit__(self, *a): return False
    async def __aenter__(self): return [1, 2]
    async def __aexit__(self, *a): return False
async def agen(items):
    for item in items:
        yield item
'''

SHAPES = {
'return in for in with': '''
def f(k):
    with CM() as c:
        for x in c:
            if x == k:
                return x
''',
'and a statement after it': '''
def f(k):
    with CM() as c:
        for x in c:
            if x == k:
                return x
    return None
''',
'break': '''
def f(k):
    with CM() as c:
        for x in c:
            if x == k:
                break
''',
'nothing leaves': '''
def f(k):
    with CM() as c:
        for x in c:
            pass
''',
'while': '''
def f(k):
    with CM() as c:
        while k:
            k -= 1
            if k == 5:
                return k
''',
'finally': '''
def f(k):
    try:
        for x in [1, 2]:
            if x == k:
                return x
    finally:
        k = 0
''',
'else': '''
def f(k):
    with CM() as c:
        for x in c:
            if x == k:
                return x
        else:
            k = 1
''',
'no loop': '''
def f(k):
    with CM() as c:
        if k:
            return 1
''',
'in a loop': '''
def f(k):
    for z in (1,):
        with CM() as c:
            for x in c:
                if x == k:
                    return x
''',
'two with statements': '''
def f(k):
    with CM() as b:
        with CM() as c:
            for x in c:
                if x == k:
                    return x
''',
'two items': '''
def f(k):
    with CM() as b, CM() as c:
        for x in c:
            if x == k:
                return x
''',
'two items on two lines': '''
def f(k):
    with (CM() as b,
          CM() as c):
        for x in c:
            if x == k:
                return x
''',
'two loops': '''
def f(k):
    with CM() as c:
        for x in c:
            for y in c:
                if y == k:
                    return x
''',
'a statement after the loop': '''
def f(k):
    with CM() as c:
        for x in c:
            if x == k:
                return x
        k = 3
''',
'return and break': '''
def f(k):
    with CM() as c:
        for x in c:
            if x == k:
                return x
            if x == k + 1:
                break
''',
'continue': '''
def f(k):
    with CM() as c:
        for x in c:
            if x == k:
                continue
            if x == k + 5:
                return x
''',
'return first': '''
def f(k):
    with CM() as c:
        if k == 7:
            return k
        for x in c:
            k += 1
''',
'the loop on the line of the with': '''
def f(k):
    with CM() as c:
        for x in c: k += 1
        for x in c:
            if x == k: return x
''',
'comprehension': '''
def f(k):
    with CM() as c:
        if k == 7:
            return k
        [x
         for x in c]
''',
'raise': '''
def f(k):
    with CM() as c:
        for x in c:
            if x == k:
                raise KeyError(x)
''',
'try in the loop': '''
def f(k):
    with CM() as c:
        for x in c:
            try:
                if x == k:
                    return x
            finally:
                k += 0
''',
'async for in with': '''
async def f(k):
    with CM() as c:
        async for x in agen(c):
            if x == k:
                return x
''',
'for in async with': '''
async def f(k):
    async with CM() as c:
        for x in c:
            if x == k:
                return x
''',
'generator': '''
def f(k):
    with CM() as c:
        for x in c:
            if x == k:
                return x
            yield x
''',
}


def call(function, k):
    try:
        result = function(k)
        if hasattr(result, 'send') and hasattr(result, '__await__'):
            return asyncio.run(result)
        if hasattr(result, 'send'):
            return list(result)
        return result
    except KeyError as e:
        return repr(e)


E = sys.monitoring.events
for name, source in SHAPES.items():
    namespace = {}
    exec(compile(PRELUDE + source, '<shape>', 'exec'), namespace)
    f = namespace['f']
    code = f.__code__
    first = code.co_firstlineno
    for k in (0, 1, 2, 7):
        seen = []

        def trace(frame, event, arg):
            if frame.f_code is code:
                seen.append((event[0], frame.f_lineno - first))
                return trace

        sys.settrace(trace)
        try:
            result = call(f, k)
        finally:
            sys.settrace(None)
        print(name, k, result, seen)

        seen = []
        sys.monitoring.use_tool_id(3, 'lines')
        sys.monitoring.register_callback(3, E.LINE, lambda code, line: seen.append(line - first))
        sys.monitoring.set_local_events(3, code, E.LINE)
        try:
            call(f, k)
        finally:
            sys.monitoring.set_local_events(3, code, 0)
            sys.monitoring.free_tool_id(3)
        print(name, k, 'monitoring', seen)
    print(name, sorted({line - first for _, _, line in code.co_lines() if line is not None}))
