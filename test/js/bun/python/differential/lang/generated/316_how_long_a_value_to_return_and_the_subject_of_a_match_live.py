# How long what has no name lives: the value of a `return` while a `finally` clause runs, also one that goes on to leave in a way of its own; the subject of a `match`; the iterator of a loop.
try: import gc, weakref, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import gc, weakref, warnings')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")
try:
    class C:
        def __iter__(s): return s
        def __next__(s): return 1
        def __enter__(s): return s
        def __exit__(s, *a): seen.append(('exit', alive())); return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C:')
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
    def p(tag=''): seen.append(alive()); return True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def p(tag=''): seen.append(alive()); return True")
try: SRC = {
 'clause': 'try:\n    return make()\nfinally:\n    p()',
 'clause, several lines': 'try:\n    return (\n        make())\nfinally:\n    p()',
 'clause that returns': 'try:\n    return make()\nfinally:\n    p()\n    return 1',
 'clause that may return': 'try:\n    return make()\nfinally:\n    p()\n    if p():\n        p()\n        return 1\n    p()',
 'clause that breaks': 'for i in (1, 2):\n    try:\n        return make()\n    finally:\n        p()\n        break\np()',
 'clause that continues': 'for i in (1, 2):\n    try:\n        return make()\n    finally:\n        p()\n        continue\np()',
 'clause that raises': 'try:\n    try:\n        return make()\n    finally:\n        p()\n        raise KeyError\nexcept KeyError:\n    p()',
 'two clauses': 'try:\n    try:\n        return make()\n    finally:\n        p()\nfinally:\n    p()\n    return 1',
 'clause with a loop': 'try:\n    return make()\nfinally:\n    for i in (1, 2):\n        p()\n    return 1',
 'clause with a try': 'try:\n    return make()\nfinally:\n    try:\n        p()\n        raise KeyError\n    except KeyError:\n        p()\n    return 1',
 'with': 'with C():\n    return make()',
 'with, several lines': 'with C():\n    return (\n        make())',
 'loop and clause': 'for i in make():\n    try:\n        return 1\n    finally:\n        p()',
 'loop and clause, a value': 'for i in make():\n    try:\n        return C()\n    finally:\n        p()',
 'gen: yield in the clause': 'try:\n    return make()\nfinally:\n    yield p()\n    p()',
 'gen: yield in the clause that returns': 'try:\n    return make()\nfinally:\n    yield p()\n    p()\n    return 1',
 'gen: yield behind what decides': 'try:\n    return make()\nfinally:\n    if p():\n        yield p()\n        p()\n        return 1',
 'match: guard of the last case': 'match make():\n    case C() if p():\n        p()',
 'match: guard, default follows': 'match make():\n    case C() if p():\n        p()\n    case _:\n        pass',
 'match: guard, a case follows': 'match make():\n    case C() if p():\n        p()\n    case C():\n        pass',
 'match: body of the default': 'match make():\n    case 1:\n        pass\n    case _:\n        p()',
 'match: capture': 'match make():\n    case 1:\n        pass\n    case x:\n        p()\n        del x\n        p()',
 'match: return in a case, clause': 'try:\n    match make():\n        case C() if p():\n            return 1\n        case _:\n            pass\nfinally:\n    p()',
 'match in match': 'match make():\n    case C():\n        match 1:\n            case 1 if p():\n                p()\n    case _:\n        pass',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: SRC = { 'clause': 'try:\\n return make()\\nfinally:\\n p()', 'clause, se...")
try:
    def indent(t): return '\n'.join('    ' + l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def indent(t): return '\\n'.join(' ' + l for l in t.split('\\n'))")
try:
    for name, body in SRC.items():
        try: ns = dict(globals())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns = dict(globals())')
        try: exec('def f():\n' + indent(body), ns)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec('def f():\\n' + indent(body), ns)")
        try: seen = ns['seen'] = []
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: seen = ns['seen'] = []")
        try: globals()['seen'] = seen
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: globals()['seen'] = seen")
        try: r = ns['f']()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: r = ns['f']()")
        if hasattr(r, 'send'):
            try:
                while True:
                    r.send(None)
                    seen.append(('suspended', alive()))
            except StopIteration as e: r = e.value
        try: r = type(r).__name__
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = type(r).__name__')
        try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'body=' + (repr(body) if type(body) in (str, int, float, bytes, bool, type(None)) or (type(body) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in body)) else body.__name__ if type(body) is type else type(body).__name__) + '] =>', name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
        try: print('|', 'seen [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'body=' + (repr(body) if type(body) in (str, int, float, bytes, bool, type(None)) or (type(body) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in body)) else body.__name__ if type(body) is type else type(body).__name__) + '] =>', seen)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen')
        try: print('r [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'body=' + (repr(body) if type(body) in (str, int, float, bytes, bool, type(None)) or (type(body) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in body)) else body.__name__ if type(body) is type else type(body).__name__) + '] =>', r)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name, body in SRC.items():')
