# No trace function. How long the value of a `return` lives where more than a `finally` clause runs on the way out, and the clause may never hand it on.
try: import gc, weakref, itertools, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import gc, weakref, itertools, warnings')
try: warnings.simplefilter("ignore")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warnings.simplefilter("ignore")')
try:
    class C:
        def __enter__(s): return s
        def __exit__(s, *a): seen.append(('exit', alive())); return False
        async def __aenter__(s): return s
        async def __aexit__(s, *a):
            seen.append(('aexit', alive())); await K(); seen.append(('aexit 2', alive())); return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C:')
try:
    class K:
        def __await__(s): yield 'k'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K:')
try:
    def alive():
        gc.collect()
        return W() is not None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def alive():')
try:
    def make():
        global W
        o = C(); W = weakref.ref(o)
        return o
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def make():')
try:
    def p(): seen.append(alive()); return True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def p(): seen.append(alive()); return True')
try:
    def items():
        try: yield 1; yield 2
        finally: seen.append(('closed', alive()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def items():')
try: WAYS = {'with': 'with C():\n    return make()', 'loop': 'for i in items():\n    return make()', 'handler': 'try:\n    raise KeyError\nexcept KeyError as e:\n    return make()',
        'inner clause': 'try:\n    return make()\nfinally:\n    p()', 'plain': 'return make()', 'async with': 'async with C():\n    return make()',
        'async with in with': 'with C():\n    async with C():\n        return make()', 'inner clause that awaits': 'try:\n    return make()\nfinally:\n    await K()\n    p()'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: WAYS = {'with': 'with C():\\n return make()', 'loop': 'for i in items(...")
try: ENDS = {'return': 'return 5', 'break': 'break', 'continue': 'continue', 'raise': 'raise IndexError', 'goes on': 'p()', 'await, return': 'await K()\np()\nreturn 5'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ENDS = {'return': 'return 5', 'break': 'break', 'continue': 'continue...")
try:
    def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def indent(t, n=4): return '\\n'.join(' ' * n + l for l in t.split('\\n'))")
try:
    for (wn, way), (en, end), outer in itertools.product(WAYS.items(), ENDS.items(), ('', 'clause')):
        try: body = 'try:\n' + indent(way) + '\nfinally:\n    p()\n' + indent(end)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: body = 'try:\\n' + indent(way) + '\\nfinally:\\n p()\\n' + indent(end)")
        if end in ('break', 'continue'): body = 'for k in (1, 2):\n' + indent(body) + '\np()'
        if outer == 'clause': body = 'try:\n' + indent(body) + '\nfinally:\n    p()'
        try: ns = dict(globals())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns = dict(globals())')
        try: exec('async def f():\n' + indent(body), ns)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec('async def f():\\n' + indent(body), ns)")
        try: seen = []
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen = []')
        try: r = ns['f']()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: r = ns['f']()")
        try:
            while True:
                r.send(None)
                seen.append(('suspended', alive()))
        except StopIteration as e: r = type(e.value).__name__
        except IndexError: r = 'IndexError'
        try: seen.append(('after', alive()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: seen.append(('after', alive()))")
        try: print('wn [' + 'outer=' + (repr(outer) if type(outer) in (str, int, float, bytes, bool, type(None)) or (type(outer) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in outer)) else outer.__name__ if type(outer) is type else type(outer).__name__) + ", " + 'wn=' + (repr(wn) if type(wn) in (str, int, float, bytes, bool, type(None)) or (type(wn) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in wn)) else wn.__name__ if type(wn) is type else type(wn).__name__) + ", " + 'way=' + (repr(way) if type(way) in (str, int, float, bytes, bool, type(None)) or (type(way) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in way)) else way.__name__ if type(way) is type else type(way).__name__) + ", " + 'en=' + (repr(en) if type(en) in (str, int, float, bytes, bool, type(None)) or (type(en) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in en)) else en.__name__ if type(en) is type else type(en).__name__) + ", " + 'end=' + (repr(end) if type(end) in (str, int, float, bytes, bool, type(None)) or (type(end) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in end)) else end.__name__ if type(end) is type else type(end).__name__) + '] =>', wn)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: wn')
        try: print('|', 'en [' + 'outer=' + (repr(outer) if type(outer) in (str, int, float, bytes, bool, type(None)) or (type(outer) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in outer)) else outer.__name__ if type(outer) is type else type(outer).__name__) + ", " + 'wn=' + (repr(wn) if type(wn) in (str, int, float, bytes, bool, type(None)) or (type(wn) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in wn)) else wn.__name__ if type(wn) is type else type(wn).__name__) + ", " + 'way=' + (repr(way) if type(way) in (str, int, float, bytes, bool, type(None)) or (type(way) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in way)) else way.__name__ if type(way) is type else type(way).__name__) + ", " + 'en=' + (repr(en) if type(en) in (str, int, float, bytes, bool, type(None)) or (type(en) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in en)) else en.__name__ if type(en) is type else type(en).__name__) + ", " + 'end=' + (repr(end) if type(end) in (str, int, float, bytes, bool, type(None)) or (type(end) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in end)) else end.__name__ if type(end) is type else type(end).__name__) + '] =>', en)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: en')
        try: print('|', 'outer [' + 'outer=' + (repr(outer) if type(outer) in (str, int, float, bytes, bool, type(None)) or (type(outer) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in outer)) else outer.__name__ if type(outer) is type else type(outer).__name__) + ", " + 'wn=' + (repr(wn) if type(wn) in (str, int, float, bytes, bool, type(None)) or (type(wn) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in wn)) else wn.__name__ if type(wn) is type else type(wn).__name__) + ", " + 'way=' + (repr(way) if type(way) in (str, int, float, bytes, bool, type(None)) or (type(way) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in way)) else way.__name__ if type(way) is type else type(way).__name__) + ", " + 'en=' + (repr(en) if type(en) in (str, int, float, bytes, bool, type(None)) or (type(en) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in en)) else en.__name__ if type(en) is type else type(en).__name__) + ", " + 'end=' + (repr(end) if type(end) in (str, int, float, bytes, bool, type(None)) or (type(end) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in end)) else end.__name__ if type(end) is type else type(end).__name__) + '] =>', outer)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: outer')
        try: print('|', 'seen [' + 'outer=' + (repr(outer) if type(outer) in (str, int, float, bytes, bool, type(None)) or (type(outer) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in outer)) else outer.__name__ if type(outer) is type else type(outer).__name__) + ", " + 'wn=' + (repr(wn) if type(wn) in (str, int, float, bytes, bool, type(None)) or (type(wn) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in wn)) else wn.__name__ if type(wn) is type else type(wn).__name__) + ", " + 'way=' + (repr(way) if type(way) in (str, int, float, bytes, bool, type(None)) or (type(way) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in way)) else way.__name__ if type(way) is type else type(way).__name__) + ", " + 'en=' + (repr(en) if type(en) in (str, int, float, bytes, bool, type(None)) or (type(en) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in en)) else en.__name__ if type(en) is type else type(en).__name__) + ", " + 'end=' + (repr(end) if type(end) in (str, int, float, bytes, bool, type(None)) or (type(end) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in end)) else end.__name__ if type(end) is type else type(end).__name__) + '] =>', seen)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen')
        try: print('r [' + 'outer=' + (repr(outer) if type(outer) in (str, int, float, bytes, bool, type(None)) or (type(outer) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in outer)) else outer.__name__ if type(outer) is type else type(outer).__name__) + ", " + 'wn=' + (repr(wn) if type(wn) in (str, int, float, bytes, bool, type(None)) or (type(wn) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in wn)) else wn.__name__ if type(wn) is type else type(wn).__name__) + ", " + 'way=' + (repr(way) if type(way) in (str, int, float, bytes, bool, type(None)) or (type(way) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in way)) else way.__name__ if type(way) is type else type(way).__name__) + ", " + 'en=' + (repr(en) if type(en) in (str, int, float, bytes, bool, type(None)) or (type(en) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in en)) else en.__name__ if type(en) is type else type(en).__name__) + ", " + 'end=' + (repr(end) if type(end) in (str, int, float, bytes, bool, type(None)) or (type(end) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in end)) else end.__name__ if type(end) is type else type(end).__name__) + '] =>', r)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for (wn, way), (en, end), outer in itertools.product(WAYS.items(), EN...')
