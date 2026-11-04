# f'{x!r:{y}}': the value is converted before what is in the format spec is looked at.
try: LOG = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LOG = []')
try:
    class Fm:
        def __format__(self, spec):
            LOG.append(('format', spec))
            return '5'
        def __repr__(self):
            LOG.append('repr')
            return 'R'
        def __str__(self):
            LOG.append('str')
            return 'S'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Fm:')
try: fm = Fm()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fm = Fm()')
try:
    for f in (lambda: f'{fm!r:{fm}}', lambda: f'{fm!s:>{fm}}', lambda: f'{fm!a:{fm}.{fm}}'):
        try: LOG.clear()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LOG.clear()')
        try: print('repr(f()) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', repr(f()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(f())')
        try: print('LOG [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', LOG)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LOG')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for f in (lambda: f'{fm!r:{fm}}', lambda: f'{fm!s:>{fm}}', lambda: f'...")


try:
    class Sub(str):
        def __format__(self, spec):
            LOG.append(('format of the result', spec))
            return 'F'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Sub(str):')


try:
    class ReprIsSub:
        def __repr__(self):
            LOG.append('repr')
            return Sub('sub')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ReprIsSub:')


try: r = ReprIsSub()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = ReprIsSub()')
try:
    for f in (lambda: f'{r!r}', lambda: f'{r!r:>4}', lambda: f'{r!r:{fm}}', lambda: f'{r!r:{"x"}}', lambda: f'{fm:{fm}}', lambda: f'{fm=!r:{fm}}'):
        try: LOG.clear()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LOG.clear()')
        try: print('repr(f()) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', repr(f()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(f())')
        try: print('LOG [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', LOG)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LOG')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for f in (lambda: f'{r!r}', lambda: f'{r!r:>4}', lambda: f'{r!r:{fm}}...")


try:
    class Fails:
        def __repr__(self):
            raise ValueError('repr')

        def __format__(self, spec):
            raise KeyError('format')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Fails:')


try:
    for f in (lambda: f'{Fails()!r:{Fails()}}', lambda: f'{1!r:{Fails()}}', lambda: f'{Fails():{Fails()}}'):
        try:
            f()
        except Exception as e:
            print('repr(e) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', repr(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for f in (lambda: f'{Fails()!r:{Fails()}}', lambda: f'{1!r:{Fails()}}...")
