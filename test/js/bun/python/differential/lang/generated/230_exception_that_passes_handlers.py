# An exception that goes on past a `finally`, a `with` or an `except` that does not match: what is being handled is put back on the way,
# whoever listens is told of each step, and a tool that raises takes the place of the exception.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')


try:
    class CM:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            print('  exit sees', repr(sys.exception()))
            return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CM:')


try:
    def through_finally():
        try:
            raise ValueError('inner')
        finally:
            print('  finally sees', repr(sys.exception()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def through_finally():')


try:
    def through_with():
        with CM():
            raise ValueError('inner')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def through_with():')


try:
    def through_except():
        try:
            raise ValueError('inner')
        except KeyError:
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def through_except():')


try:
    def through_named_handler():
        try:
            raise ValueError('first')
        except ValueError as e:
            raise ValueError('inner')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def through_named_handler():')


try:
    def through_all():
        try:
            with CM():
                try:
                    try:
                        raise ValueError('inner')
                    except KeyError:
                        pass
                finally:
                    print('  finally sees', repr(sys.exception()))
        finally:
            print('  outer finally sees', repr(sys.exception()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def through_all():')


try:
    async def agen():
        yield 1
        raise ValueError('inner')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def agen():')


try:
    async def through_async_for_body():
        async for x in agen():
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def through_async_for_body():')


try:
    def through_async_for():
        c = through_async_for_body()
        try:
            c.send(None)
        finally:
            c.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def through_async_for():')


try: cases = [through_finally, through_with, through_except, through_named_handler, through_all, through_async_for]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cases = [through_finally, through_with, through_except, through_named...')

try: print('--- what is being handled afterwards')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- what is being handled afterwards'")
try:
    for f in cases:
        try: print('f.__name__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__name__')
        try:
            f()
        except ValueError as e:
            print('  caught', 'repr(e) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', repr(e))
            print('repr(e.__context__) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', repr(e.__context__))
            print('repr(sys.exception()) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', repr(sys.exception()))
        try: print('  after', 'repr(sys.exception()) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', repr(sys.exception()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(sys.exception())')
        try:
            raise KeyError('outer')
        except KeyError:
            try:
                f()
            except ValueError as e:
                print('  caught', 'repr(e) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', repr(e))
                print('repr(e.__context__) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', repr(e.__context__))
                print('repr(e.__context__ and e.__context__.__context__) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', repr(e.__context__ and e.__context__.__context__))
                print('repr(sys.exception()) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', repr(sys.exception()))
            print('  in the outer handler', 'repr(sys.exception()) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', repr(sys.exception()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in cases:')

try: print('--- a generator suspended in the clause')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- a generator suspended in the clause'")


try:
    def gen():
        try:
            raise ValueError('inner')
        finally:
            print('  in gen', repr(sys.exception()))
            yield 1
            print('  in gen again', repr(sys.exception()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen():')


try: g = gen()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = gen()')
try: next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print(' ', 'repr(sys.exception()) =>', repr(sys.exception()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(sys.exception())')
try:
    try:
        raise KeyError('outer')
    except KeyError:
        try:
            next(g)
        except ValueError as e:
            print('  caught', 'repr(e) =>', repr(e))
            print('repr(e.__context__) =>', repr(e.__context__))
            print('repr(sys.exception()) =>', repr(sys.exception()))
        print(' ', 'repr(sys.exception()) =>', repr(sys.exception()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')

try: print('--- the traceback has each frame once')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- the traceback has each frame once'")
try:
    for f in cases:
        try:
            f()
        except ValueError as e:
            tb = e.__traceback__
            entries = []
            while tb:
                entries.append((tb.tb_frame.f_code.co_name, tb.tb_lineno - tb.tb_frame.f_code.co_firstlineno))
                tb = tb.tb_next
            print('f.__name__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__name__)
            print('entries [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', entries)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in cases:')

try: print('--- tools')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- tools'")
try: M = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M = sys.monitoring')
try: names = {f.__name__ for f in cases} | {'through_async_for_body'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: names = {f.__name__ for f in cases} | {'through_async_for_body'}")
try: seen = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen = []')


try:
    def listen(raise_at=None):
        count = [0]

        def make(name):
            def callback(code, offset, exception):
                if code.co_name not in names:
                    return
                seen.append((name, type(exception).__name__, repr(sys.exception())))
                if name == 'EXCEPTION_HANDLED':
                    return
                count[0] += 1
                if count[0] == raise_at:
                    raise RuntimeError('from the tool, at ' + name)
            return callback
        M.use_tool_id(2, 'test')
        mask = 0
        for name in ('RAISE', 'RERAISE', 'EXCEPTION_HANDLED', 'PY_UNWIND'):
            M.register_callback(2, getattr(M.events, name), make(name))
            mask |= getattr(M.events, name)
        M.set_events(2, mask)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def listen(raise_at=None):')


try:
    def stop():
        M.set_events(2, 0)
        M.free_tool_id(2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def stop():')


try: _print = print
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: _print = print')
try:
    for f in (through_finally, through_except, through_with, through_named_handler):
        for raise_at in (None, 1, 2, 3, 4):
            try: seen.clear()
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen.clear()')
            try: out = []
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out = []')
            try: print = lambda *a: out.append(a)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print = lambda *a: out.append(a)')
            try: listen(raise_at)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: listen(raise_at)')
            try:
                try:
                    raise KeyError('outer')
                except KeyError:
                    try:
                        f()
                    finally:
                        stop()
                        handled = repr(sys.exception())
            except BaseException as e:
                print = _print
                tb = e.__traceback__
                frames = []
                while tb:
                    frames.append(tb.tb_frame.f_code.co_name)
                    tb = tb.tb_next
                print('f.__name__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + ", " + 'raise_at=' + (repr(raise_at) if type(raise_at) in (str, int, float, bytes, bool, type(None)) or (type(raise_at) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in raise_at)) else raise_at.__name__ if type(raise_at) is type else type(raise_at).__name__) + '] =>', f.__name__)
                print('raise_at [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + ", " + 'raise_at=' + (repr(raise_at) if type(raise_at) in (str, int, float, bytes, bool, type(None)) or (type(raise_at) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in raise_at)) else raise_at.__name__ if type(raise_at) is type else type(raise_at).__name__) + '] =>', raise_at)
                print('repr(e) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + ", " + 'raise_at=' + (repr(raise_at) if type(raise_at) in (str, int, float, bytes, bool, type(None)) or (type(raise_at) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in raise_at)) else raise_at.__name__ if type(raise_at) is type else type(raise_at).__name__) + '] =>', repr(e))
                print('repr(e.__context__) [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + ", " + 'raise_at=' + (repr(raise_at) if type(raise_at) in (str, int, float, bytes, bool, type(None)) or (type(raise_at) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in raise_at)) else raise_at.__name__ if type(raise_at) is type else type(raise_at).__name__) + '] =>', repr(e.__context__))
                print('handled [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + ", " + 'raise_at=' + (repr(raise_at) if type(raise_at) in (str, int, float, bytes, bool, type(None)) or (type(raise_at) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in raise_at)) else raise_at.__name__ if type(raise_at) is type else type(raise_at).__name__) + '] =>', handled)
                print('frames [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + ", " + 'raise_at=' + (repr(raise_at) if type(raise_at) in (str, int, float, bytes, bool, type(None)) or (type(raise_at) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in raise_at)) else raise_at.__name__ if type(raise_at) is type else type(raise_at).__name__) + '] =>', frames)
                for item in seen:
                    print('   ', *item)
            try: print = _print
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print = _print')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (through_finally, through_except, through_with, through_name...')
