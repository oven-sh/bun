# Where a `for` loop ends, CPython drops the iterator, and that is no news of a line. Nor does it count as the instruction before the next one: if what
# is laid out in front of it is of the same line as what follows, which is so when a `return` in the loop has left a `with` statement, no line
# begins there, and nobody is told of the line of the `with` when the loop has run out.
try: import asyncio, sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import asyncio, sys')

try: PRELUDE = '''
class CM:
    def __enter__(self): return [1, 2]
    def __exit__(self, *a): return False
    async def __aenter__(self): return [1, 2]
    async def __aexit__(self, *a): return False
async def agen(items):
    for item in items:
        yield item
'''
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: PRELUDE = ''' class CM: def __enter__(self): return [1, 2] def __exit...")

try: SHAPES = {
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: SHAPES = { 'return in for in with': ''' def f(k): with CM() as c: for...")


try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def call(function, k):')


try: E = sys.monitoring.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E = sys.monitoring.events')
try:
    for name, source in SHAPES.items():
        try: namespace = {}
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: namespace = {}')
        try: exec(compile(PRELUDE + source, '<shape>', 'exec'), namespace)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec(compile(PRELUDE + source, '<shape>', 'exec'), namespace)")
        try: f = namespace['f']
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: f = namespace['f']")
        try: code = f.__code__
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: code = f.__code__')
        try: first = code.co_firstlineno
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first = code.co_firstlineno')
        for k in (0, 1, 2, 7):
            try: seen = []
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen = []')

            def trace(frame, event, arg):
                if frame.f_code is code:
                    seen.append((event[0], frame.f_lineno - first))
                    return trace

            try: sys.settrace(trace)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(trace)')
            try:
                result = call(f, k)
            finally:
                sys.settrace(None)
            try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'k=' + (repr(k) if type(k) in (str, int, float, bytes, bool, type(None)) or (type(k) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in k)) else k.__name__ if type(k) is type else type(k).__name__) + '] =>', name)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
            try: print('k [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'k=' + (repr(k) if type(k) in (str, int, float, bytes, bool, type(None)) or (type(k) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in k)) else k.__name__ if type(k) is type else type(k).__name__) + '] =>', k)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: k')
            try: print('result [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'k=' + (repr(k) if type(k) in (str, int, float, bytes, bool, type(None)) or (type(k) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in k)) else k.__name__ if type(k) is type else type(k).__name__) + '] =>', result)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: result')
            try: print('seen [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'k=' + (repr(k) if type(k) in (str, int, float, bytes, bool, type(None)) or (type(k) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in k)) else k.__name__ if type(k) is type else type(k).__name__) + '] =>', seen)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen')

            try: seen = []
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen = []')
            try: sys.monitoring.use_tool_id(3, 'lines')
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: sys.monitoring.use_tool_id(3, 'lines')")
            try: sys.monitoring.register_callback(3, E.LINE, lambda code, line: seen.append(line - first))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.monitoring.register_callback(3, E.LINE, lambda code, line: seen.a...')
            try: sys.monitoring.set_local_events(3, code, E.LINE)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.monitoring.set_local_events(3, code, E.LINE)')
            try:
                call(f, k)
            finally:
                sys.monitoring.set_local_events(3, code, 0)
                sys.monitoring.free_tool_id(3)
            try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'k=' + (repr(k) if type(k) in (str, int, float, bytes, bool, type(None)) or (type(k) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in k)) else k.__name__ if type(k) is type else type(k).__name__) + '] =>', name)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
            try: print('k [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'k=' + (repr(k) if type(k) in (str, int, float, bytes, bool, type(None)) or (type(k) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in k)) else k.__name__ if type(k) is type else type(k).__name__) + '] =>', k)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: k')
            try: print('monitoring', 'seen [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'k=' + (repr(k) if type(k) in (str, int, float, bytes, bool, type(None)) or (type(k) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in k)) else k.__name__ if type(k) is type else type(k).__name__) + '] =>', seen)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen')
        try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
        try: print('sorted({line - first for _, _, line in code.co_lines() if line is not... [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', sorted({line - first for _, _, line in code.co_lines() if line is not None}))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted({line - first for _, _, line in code.co_lines() if line is not...')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name, source in SHAPES.items():')
