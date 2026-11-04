# A `return` that has got as far as a `finally` and is given up there, by a `break` or a `continue`: what the function returns in the end.
try: import warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import warnings')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")
try:
    def f1():
        for i in (2,):
            try:
                try:
                    return 1
                finally:
                    break
            finally:
                pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f1():')
try:
    def f2():
        for i in (2,):
            try:
                return 1
            finally:
                break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f2():')
try:
    def f3():
        for i in (1, 2):
            try:
                try:
                    return i
                finally:
                    continue
            finally:
                pass
        return 'end'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f3():')
try:
    def f4():
        for i in (2,):
            with open(__file__):
                try:
                    return 1
                finally:
                    break
        return 'end'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f4():')
try:
    def f5():
        for i in (2,):
            try:
                try:
                    raise ValueError(1)
                finally:
                    break
            finally:
                pass
        return 'end'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f5():')
try:
    def f6():
        while True:
            try:
                try:
                    return 1
                finally:
                    break
            except ValueError:
                pass
        return 'end'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f6():')
try:
    def f7():
        for i in (2,):
            try:
                try:
                    try:
                        return 1
                    finally:
                        break
                finally:
                    pass
            finally:
                pass
        return 'end'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f7():')
try:
    def f8():
        try:
            for i in (2,):
                try:
                    return 1
                finally:
                    break
        finally:
            pass
        return 'end'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f8():')
try:
    for f in (f1, f2, f3, f4, f5, f6, f7, f8):
        try: print('f.__name__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__name__')
        try: print('f() [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (f1, f2, f3, f4, f5, f6, f7, f8):')


# The loop stands in a `finally` that another `return` is running: that one goes on.
try:
    def f9():
        try:
            return 'outer'
        finally:
            for i in (2,):
                try:
                    return 'inner'
                finally:
                    break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f9():')


try:
    def f10():
        for j in (1,):
            try:
                return 'outer'
            finally:
                for i in (2,):
                    try:
                        return 'inner'
                    finally:
                        break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f10():')


try:
    def f11():
        for j in (1,):
            try:
                return 'outer'
            finally:
                for i in (2,):
                    try:
                        return 'inner'
                    finally:
                        break
                break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f11():')


try:
    def f12(n):
        while n:
            try:
                return n
            finally:
                n -= 1
                if n == 1:
                    break
                continue
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f12(n):')


try:
    def f13():
        for i in (1, 2):
            with open(__file__):
                try:
                    return i
                finally:
                    if i == 2:
                        break
                    continue
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f13():')


try:
    async def f14():
        for i in (2,):
            try:
                return 1
            finally:
                break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def f14():')


try:
    def f15():
        for i in (2,):
            try:
                return (yield 1)
            finally:
                break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f15():')


try:
    for f in (f9, f10, f11, lambda: f12(3), f13):
        try: print('f() [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (f9, f10, f11, lambda: f12(3), f13):')
try:
    try:
        f14().send(None)
    except StopIteration as e:
        print(e.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: g = f15()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = f15()')
try: print(next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try:
    try:
        g.send(5)
    except StopIteration as e:
        print(e.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
