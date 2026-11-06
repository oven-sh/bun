# A trace function raises when it is told of the line of a `return (` whose value, with several ways through it, has been computed: which `try`, `with`, loop and handler is it still in?
try: import sys, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, warnings')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")
try:
    def c(v): return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c(v): return v')
try:
    class E(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(Exception): pass')
try: R = {'try except in try finally': '''def f(a, b, d):
    try:
        try:
            return (
                b if a else
                d)
        except E:
            LOG.append('caught'); return 'handled'
    finally:
        LOG.append('finally')
''', 'try finally': '''def f(a, b, d):
    try:
        return (
            b if a else
            d)
    finally:
        LOG.append('finally')
''', 'with in try finally': '''def f(a, b, d):
    try:
        with W():
            return (
                b if a else
                d)
    finally:
        LOG.append('finally')
''', 'loop in try finally': '''def f(a, b, d):
    try:
        for i in gen():
            return (
                b if a else
                d)
    finally:
        LOG.append('finally')
''', 'handler in try finally': '''def f(a, b, d):
    try:
        try:
            raise E
        except E as e:
            return (
                b if a else
                d)
    finally:
        LOG.append('finally')
''', 'try finally in try except': '''def f(a, b, d):
    try:
        try:
            return (
                b if a else
                d)
        finally:
            LOG.append('finally')
    except E:
        LOG.append('caught'); return 'handled'
''', 'two try finally': '''def f(a, b, d):
    try:
        try:
            return (
                b or
                d)
        finally:
            LOG.append('inner')
    finally:
        LOG.append('finally')
''', 'try finally in a with': '''def f(a, b, d):
    with W():
        try:
            return (
                b if a else
                d)
        finally:
            LOG.append('finally')
''', 'try finally in a loop': '''def f(a, b, d):
    for i in gen():
        try:
            return (
                [x for x in (b, d)
                 if a])
        finally:
            LOG.append('finally')
''', 'while in try finally': '''def f(a, b, d):
    try:
        while c(1):
            return (
                b if a else
                d)
    finally:
        LOG.append('finally')
''', 'while in while with an else in try finally': '''def f(a, b, d):
    try:
        while c(1):
            while c(1):
                return (
                    b if a else
                    d)
            else:
                LOG.append('else')
    finally:
        LOG.append('finally')
''', 'while in try except in try finally': '''def f(a, b, d):
    try:
        try:
            while c(1):
                return (
                    b if a else
                    d)
        except E:
            LOG.append('caught'); return 'handled'
    finally:
        LOG.append('finally')
''', 'while in a with in try finally': '''def f(a, b, d):
    try:
        with W():
            while c(1):
                return (
                    b if a else
                    d)
    finally:
        LOG.append('finally')
''', 'try except in a handler in try finally': '''def f(a, b, d):
    try:
        try:
            raise E
        except E:
            try:
                return (
                    b if a else
                    d)
            except E:
                LOG.append('caught'); return 'handled'
    finally:
        LOG.append('finally')
''', 'try except in a loop in try finally': '''def f(a, b, d):
    try:
        for i in gen():
            try:
                return (
                    b if a else
                    d)
            except E:
                LOG.append('caught'); return 'handled'
    finally:
        LOG.append('finally')
''', 'try except in a with in try finally': '''def f(a, b, d):
    try:
        with W():
            try:
                return (
                    b if a else
                    d)
            except E:
                LOG.append('caught'); return 'handled'
    finally:
        LOG.append('finally')
''', 'no ways meet': '''def f(a, b, d):
    try:
        try:
            return (
                c(
                b))
        except E:
            LOG.append('caught'); return 'handled'
    finally:
        LOG.append('finally')
'''}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: R = {'try except in try finally': '''def f(a, b, d): try: try: return...")
try:
    class W:
        def __enter__(self): return self
        def __exit__(self, *a): LOG.append('exit'); return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class W:')
try:
    def gen():
        try: yield 1
        finally: LOG.append('closed')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen():')
try:
    for name, src in R.items():
        for a in (0, 1):
            try: LOG = []
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LOG = []')
            try: seen = []
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen = []')
            try: g = dict(c=c, E=E, W=W, gen=gen, LOG=LOG)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = dict(c=c, E=E, W=W, gen=gen, LOG=LOG)')
            try: exec(compile(src, 'p', 'exec'), g)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec(compile(src, 'p', 'exec'), g)")
            try: target = [i + 1 for i, l in enumerate(src.split('\n')) if 'return (' in l][0]
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: target = [i + 1 for i, l in enumerate(src.split('\\n')) if 'return (' ...")
            def tr(fr, e, arg):
                if fr.f_code.co_filename != 'p': return None
                if e == 'line':
                    seen.append(fr.f_lineno)
                    if fr.f_lineno == target and (seen.count(target) == 2 or len(seen) > 1 and seen[-2] > target): seen.append('raise'); raise E
                return tr
            try: sys.settrace(tr)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(tr)')
            try: r = g['f'](a, 'b', 'd')
            except E: r = 'E came out'
            finally: sys.settrace(None)
            try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + ", " + 'a=' + (repr(a) if type(a) in (str, int, float, bytes, bool, type(None)) or (type(a) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in a)) else a.__name__ if type(a) is type else type(a).__name__) + '] =>', name)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
            try: print('|', 'a [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + ", " + 'a=' + (repr(a) if type(a) in (str, int, float, bytes, bool, type(None)) or (type(a) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in a)) else a.__name__ if type(a) is type else type(a).__name__) + '] =>', a)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a')
            try: print('|', 'seen [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + ", " + 'a=' + (repr(a) if type(a) in (str, int, float, bytes, bool, type(None)) or (type(a) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in a)) else a.__name__ if type(a) is type else type(a).__name__) + '] =>', seen)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen')
            try: print('r [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + ", " + 'a=' + (repr(a) if type(a) in (str, int, float, bytes, bool, type(None)) or (type(a) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in a)) else a.__name__ if type(a) is type else type(a).__name__) + '] =>', r)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r')
            try: print('LOG [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + ", " + 'a=' + (repr(a) if type(a) in (str, int, float, bytes, bool, type(None)) or (type(a) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in a)) else a.__name__ if type(a) is type else type(a).__name__) + '] =>', LOG)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LOG')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name, src in R.items():')
