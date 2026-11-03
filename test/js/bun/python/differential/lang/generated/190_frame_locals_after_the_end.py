# What a frame object shows of a call that has ended: tracebacks, sys._getframe(), debuggers post mortem.
try: import sys, traceback
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, traceback')
try:
    def show(tb):
        while tb:
            f = tb.tb_frame
            print(f.f_code.co_name, tb.tb_lineno, f.f_lineno, sorted((k, getattr(v, '__qualname__', None) or repr(v)) for k, v in f.f_locals.items() if not k.startswith('__') and k not in ('sys','traceback','show','outer','inner','C','gen','agen','e','tb','run','deep','cellfn','mk', 'tbs', 'saved', 'f', 'k', 'v', 'te', 'line', 'frames', 'getf', 'fr', 'g', 'comp', 'withfn', 'CM', 'late', 'r', 'cls')))
            tb = tb.tb_next
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(tb):')
try:
    def inner(a, b=2, *args, c=3, **kw):
        x = a + b
        y = [x]
        del b
        z = 1 / 0
        never = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def inner(a, b=2, *args, c=3, **kw):')
try:
    def outer(p):
        q = p * 2
        inner(q, 5, 6, 7, c=8, d=9)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer(p):')
try:
    try:
        outer(10)
    except ZeroDivisionError as e:
        show(e.__traceback__)
        saved = e.__traceback__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: show(saved)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(saved)')
# cells and free variables
try:
    def cellfn(n):
        total = n
        def add(m):
            nonlocal total
            total += m
            loc = total
            raise ValueError(loc)
        add(5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cellfn(n):')
try:
    try:
        cellfn(1)
    except ValueError as e:
        show(e.__traceback__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
# class body
try:
    try:
        class C:
            attr = 1
            other = attr + 1
            boom = 1 / 0
    except ZeroDivisionError as e:
        tb = e.__traceback__.tb_next
        print('tb.tb_frame.f_code.co_name =>', tb.tb_frame.f_code.co_name)
        print('sorted(k for k in tb.tb_frame.f_locals) =>', sorted(k for k in tb.tb_frame.f_locals))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
# generator
try:
    def gen(n):
        i = n
        yield i
        j = i + 1
        raise KeyError(j)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen(n):')
try: g = gen(3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = gen(3)')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try:
    try:
        next(g)
    except KeyError as e:
        show(e.__traceback__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: print(g.gi_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame')
# comprehension
try:
    def comp(n):
        pre = n
        return [1 / (k - 2) for k in range(n)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def comp(n):')
try:
    try:
        comp(5)
    except ZeroDivisionError as e:
        show(e.__traceback__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
# frame object taken by sys._getframe, read after return
try:
    def getf(a):
        b = a + 1
        fr = sys._getframe()
        c = b + 1
        return fr
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def getf(a):')
try: fr = getf(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fr = getf(1)')
try: print("sorted((k, v) for k, v in fr.f_locals.items() if k != 'fr') =>", sorted((k, v) for k, v in fr.f_locals.items() if k != 'fr'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: sorted((k, v) for k, v in fr.f_locals.items() if k != 'fr')")
try: print('fr.f_lineno =>', fr.f_lineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fr.f_lineno')
try: print('fr.f_back is sys._getframe() =>', fr.f_back is sys._getframe())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fr.f_back is sys._getframe()')
# with statement / exception in __exit__
try:
    class CM:
        def __enter__(self): return 5
        def __exit__(self, *a):
            inexit = 1
            return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CM:')
try:
    def withfn():
        with CM() as v1:
            w = v1 + 1
            raise RuntimeError(w)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def withfn():')
try:
    try:
        withfn()
    except RuntimeError as e:
        show(e.__traceback__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
# capture_locals
try:
    try:
        outer(1)
    except ZeroDivisionError as e:
        te = traceback.TracebackException.from_exception(e, capture_locals=True)
        for frame in te.stack[1:]:
            print('frame.name [' + 'frame=' + (repr(frame) if type(frame) in (str, int, float, bytes, bool, type(None)) or (type(frame) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in frame)) else frame.__name__ if type(frame) is type else type(frame).__name__) + '] =>', frame.name)
            print('frame.lineno [' + 'frame=' + (repr(frame) if type(frame) in (str, int, float, bytes, bool, type(None)) or (type(frame) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in frame)) else frame.__name__ if type(frame) is type else type(frame).__name__) + '] =>', frame.lineno)
            print('sorted(frame.locals.items()) [' + 'frame=' + (repr(frame) if type(frame) in (str, int, float, bytes, bool, type(None)) or (type(frame) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in frame)) else frame.__name__ if type(frame) is type else type(frame).__name__) + '] =>', sorted(frame.locals.items()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
# writes through f_locals after the end
try: fr.f_locals['a'] = 100
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: fr.f_locals['a'] = 100")
try: fr.f_locals['new'] = 7
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: fr.f_locals['new'] = 7")
try: print(sorted((k, v) for k, v in fr.f_locals.items() if k != 'fr'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: sorted((k, v) for k, v in fr.f_locals.items() if k != 'fr')")
# clear
try: fr.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fr.clear()')
try: print(sorted(fr.f_locals))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(fr.f_locals)')
# late: variables assigned after frame object creation and exception
try:
    def late():
        f = sys._getframe()
        try:
            a = 1
            raise OSError
        except OSError:
            b = 2
        c = 3
        return f
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def late():')
try: r = late()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = late()')
try: print(sorted((k, v) for k, v in r.f_locals.items() if k != 'f'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: sorted((k, v) for k, v in r.f_locals.items() if k != 'f')")
