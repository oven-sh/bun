# An exception that a handler has caught and has not named, and those who can get at it all the same: other threads, finalizers, signal
# handlers, the collector's view of the heap, faulthandler; handlers at the end of the stack; exceptions that built-in functions swallow.
try: import faulthandler, gc, os, signal, sys, tempfile, threading, traceback
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import faulthandler, gc, os, signal, sys, tempfile, threading, traceback')


try:
    def look(e, depth=0):
        if e is None:
            return None
        if depth == 3:
            return '...'
        rows = []
        tb = e.__traceback__
        same = tb is e.__traceback__
        while tb is not None:
            rows.append((tb.tb_frame.f_code.co_name, tb.tb_lineno - tb.tb_frame.f_code.co_firstlineno, tb.tb_frame.f_lineno - tb.tb_frame.f_code.co_firstlineno))
            tb = tb.tb_next
        return type(e).__name__, repr(e.args), same, rows, look(e.__context__, depth + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def look(e, depth=0):')


# ---- Another thread asks while this one is parked in its handler ----

try:
    def parked(kind, asks):
        entered, leave, seen = threading.Event(), threading.Event(), []

        def raises():
            if kind == 'statement':
                raise KeyError('parked')
            if kind == 'native':
                {}['parked']
            if kind == 'callee':
                def deeper():
                    raise KeyError('parked')
                deeper()

        def worker():
            try:
                raises()
            except LookupError:
                entered.set()
                leave.wait()
                seen.append(('own, late', look(sys.exception())))
            seen.append(('after', sys.exception()))

        thread = threading.Thread(target=worker)
        thread.start()
        entered.wait()
        kept = asks(thread.ident)
        seen.append(('asked', kept if isinstance(kept, (str, int, type(None))) else look(kept)))
        leave.set()
        thread.join()
        if isinstance(kept, BaseException):
            seen.append(('kept', look(kept)))
        return seen
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def parked(kind, asks):')


try:
    def by_current_exceptions(ident):
        return sys._current_exceptions()[ident]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def by_current_exceptions(ident):')


try:
    def by_current_exceptions_twice(ident):
        first = sys._current_exceptions()[ident]
        return first if first is sys._current_exceptions()[ident] and first.__traceback__ is first.__traceback__ else 'not the same'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def by_current_exceptions_twice(ident):')


try:
    def by_objects(ident):
        found = [o for o in gc.get_objects() if type(o) is KeyError and o.args == ('parked',)]
        return found[0] if len(found) == 1 else len(found)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def by_objects(ident):')


try:
    def by_frames(ident):
        frame = sys._current_frames()[ident]
        names = []
        while frame is not None:
            names.append(frame.f_code.co_name)
            frame = frame.f_back
        return '<'.join(names[-4:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def by_frames(ident):')


try:
    def by_faulthandler(ident):
        with tempfile.TemporaryFile() as file:
            faulthandler.dump_traceback(file, all_threads=True)
            file.seek(0)
            text = file.read().decode()
        return text.count(' in worker') + text.count(' in parked')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def by_faulthandler(ident):')


try:
    def by_collection(ident):
        gc.collect()
        return None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def by_collection(ident):')


try:
    for kind in ('statement', 'native', 'callee'):
        for asks in (by_current_exceptions, by_current_exceptions_twice, by_objects, by_frames, by_faulthandler, by_collection):
            try: print('kind [' + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + ", " + 'asks=' + (repr(asks) if type(asks) in (str, int, float, bytes, bool, type(None)) or (type(asks) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in asks)) else asks.__name__ if type(asks) is type else type(asks).__name__) + '] =>', kind)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kind')
            try: print('asks.__name__ [' + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + ", " + 'asks=' + (repr(asks) if type(asks) in (str, int, float, bytes, bool, type(None)) or (type(asks) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in asks)) else asks.__name__ if type(asks) is type else type(asks).__name__) + '] =>', asks.__name__)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: asks.__name__')
            try: print('parked(kind, asks) [' + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + ", " + 'asks=' + (repr(asks) if type(asks) in (str, int, float, bytes, bool, type(None)) or (type(asks) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in asks)) else asks.__name__ if type(asks) is type else type(asks).__name__) + '] =>', parked(kind, asks))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: parked(kind, asks)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for kind in ('statement', 'native', 'callee'):")


# ---- Threads that take turns in the middle of handlers ----

try:
    def taking_turns():
        before = sys.getswitchinterval()
        sys.setswitchinterval(1e-6)
        wrong = []
        stop = []

        def deeper(ident, i):
            try:
                raise ValueError(ident, i)
            except ValueError:
                for k in range(5):
                    pass
                if i % 7 == 0:
                    e = sys.exception()
                    if e.args != (ident, i) or [tb.tb_frame.f_code.co_name for tb in (e.__traceback__,)] != ['deeper'] or e.__context__.args not in ((ident, i, 'outer'), ((ident, i, 'outer'),)):
                        wrong.append(('inner', ident, i, e.args))

        def worker(ident):
            for i in range(400):
                try:
                    if i % 2:
                        raise KeyError(ident, i, 'outer')
                    {}[ident, i, 'outer']
                except KeyError:
                    deeper(ident, i)
                    if i % 5 == 0:
                        e = sys.exception()
                        if e.args not in ((ident, i, 'outer'), ((ident, i, 'outer'),)) or e.__traceback__.tb_frame is not sys._getframe() or e.__traceback__.tb_next is not None:
                            wrong.append(('outer', ident, i, e.args))
                if sys.exception() is not None:
                    wrong.append(('after', ident, i))

        def watcher():
            while not stop:
                for ident, e in sys._current_exceptions().items():
                    if e is not None and e.__traceback__ is None:
                        wrong.append(('no traceback', e.args))

        threads = [threading.Thread(target=worker, args=(n,)) for n in range(4)] + [threading.Thread(target=watcher)]
        for thread in threads:
            thread.start()
        for thread in threads[:-1]:
            thread.join()
        stop.append(1)
        threads[-1].join()
        sys.setswitchinterval(before)
        return wrong
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def taking_turns():')


try: print('taking turns:', 'taking_turns() =>', taking_turns())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: taking_turns()')


# ---- On top of the handler: a finalizer, a signal handler, a trace function that is switched on there ----

try:
    class Finalized:
        def __init__(self, seen):
            self.seen = seen

        def __del__(self):
            self.seen.append(('finalizer', look(sys.exception())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Finalized:')


try:
    def with_finalizer(collects):
        seen = []
        try:
            raise KeyError('finalizer')
        except KeyError:
            thing = Finalized(seen)
            if collects:
                thing.me = thing
            del thing; gc.collect()
            seen.append(('handler', look(sys.exception())))
        return seen
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def with_finalizer(collects):')


try: print(with_finalizer(False))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with_finalizer(False)')
try: print(with_finalizer(True))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with_finalizer(True)')


try:
    def with_signal():
        seen = []
        kept = []

        def handler(number, frame):
            kept.append(sys.exception())
            seen.append(('signal', frame.f_code.co_name, look(sys.exception())))

        before = signal.signal(signal.SIGUSR1, handler)
        try:
            try:
                {}['signal']
            except KeyError:
                os.kill(os.getpid(), signal.SIGUSR1)
                for i in range(1000):
                    if seen:
                        break
            seen.append(('after', sys.exception(), look(kept[0])))
        finally:
            signal.signal(signal.SIGUSR1, before)
        return seen
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def with_signal():')


try: print(with_signal())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with_signal()')


try:
    def with_trace():
        seen = []

        def trace(frame, event, argument):
            if event == 'exception':
                seen.append((event, frame.f_code.co_name, argument[0].__name__, look(argument[1])))
            return trace

        def inner():
            try:
                raise KeyError('traced')
            except KeyError:
                sys.settrace(trace)
                sys._getframe().f_trace = trace
                try:
                    raise ValueError('inner')
                except ValueError:
                    pass
                seen.append(look(sys.exception()))
                sys.settrace(None)
        inner()
        return seen
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def with_trace():')


try: print(with_trace())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with_trace()')


try:
    def with_monitoring():
        seen = []
        E = sys.monitoring.events
        sys.monitoring.use_tool_id(3, 'doors')
        sys.monitoring.register_callback(3, E.RERAISE, lambda code, offset, e: seen.append(('reraise', code.co_name, look(e))))
        sys.monitoring.register_callback(3, E.PY_UNWIND, lambda code, offset, e: seen.append(('unwind', code.co_name, look(e))))
        sys.monitoring.register_callback(3, E.EXCEPTION_HANDLED, lambda code, offset, e: seen.append(('handled', code.co_name, look(e))))

        def inner():
            try:
                raise KeyError('monitored')
            except ValueError:
                pass
            except KeyError:
                sys.monitoring.set_events(3, E.RERAISE | E.PY_UNWIND | E.EXCEPTION_HANDLED)
                raise
        try:
            inner()
        except KeyError:
            pass
        sys.monitoring.set_events(3, 0)
        sys.monitoring.free_tool_id(3)
        return seen
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def with_monitoring():')


try: print(with_monitoring())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with_monitoring()')


# ---- To the end of the stack in a handler ----

try:
    def to_the_limit():
        depth = 0

        def down():
            nonlocal depth
            depth += 1
            try:
                raise KeyError(depth)
            except KeyError:
                down()

        try:
            raise ValueError('start')
        except ValueError:
            try:
                down()
            except RecursionError as e:
                count = 0
                tb = e.__traceback__
                while tb is not None:
                    count += 1
                    tb = tb.tb_next
                contexts = 0
                c = e.__context__
                first = c
                while c is not None:
                    contexts += 1
                    last = c
                    c = c.__context__
                return (count == depth + 1 or (count, depth), contexts == depth + 1 or (contexts, depth), type(first).__name__, look(last), look(first)[3], type(sys.exception()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def to_the_limit():')


try: sys.setrecursionlimit(300)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.setrecursionlimit(300)')
try: print(to_the_limit())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: to_the_limit()')
try: print(to_the_limit())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: to_the_limit()')
try: sys.setrecursionlimit(1000)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.setrecursionlimit(1000)')


# ---- Swallowed by a built-in function ----

try:
    class Raises:
        def __init__(self, seen):
            self.seen = seen

        def __getattr__(self, name):
            try:
                raise KeyError(name)
            except KeyError:
                self.seen.append(look(sys.exception()))
                raise AttributeError(name)

        def __hash__(self):
            raise TypeError('no hash')

        def __next__(self):
            try:
                {}['next']
            except KeyError:
                raise StopIteration

        def __iter__(self):
            return self

        def __bool__(self):
            raise ValueError('no truth')

        def __eq__(self, other):
            raise ArithmeticError('no equality')

        def __contains__(self, item):
            raise LookupError('no items')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Raises:')


try:
    class NoLength:
        def __len__(self):
            raise IndexError('no length')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoLength:')


try:
    def swallowed():
        seen = []
        r = Raises(seen)
        out = [hasattr(r, 'a'), getattr(r, 'b', 'default'), next(r, 'default'), list(r), [x for x in r], sys.exception()]
        for label, function in (('get', lambda: {}.get(r)), ('in', lambda: r in {}), ('set', lambda: {r}), ('bool', lambda: not r), ('len', lambda: len(NoLength())),
                                ('eq', lambda: [r].index(1)), ('contains', lambda: 1 in r), ('attr', lambda: r.c), ('sorted', lambda: sorted([NoLength()], key=len))):
            try:
                function()
            except Exception:
                out.append((label, look(sys.exception())))
            try:
                function()
            except Exception:
                pass
            out.append(sys.exception())
        try:
            raise OSError('outer')
        except OSError:
            out += [hasattr(r, 'd'), getattr(r, 'e', 'default'), next(r, 'default'), look(sys.exception())]
        return out, seen
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def swallowed():')


try:
    for row in swallowed():
        for item in row:
            try: print('item [' + 'row=' + (repr(row) if type(row) in (str, int, float, bytes, bool, type(None)) or (type(row) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in row)) else row.__name__ if type(row) is type else type(row).__name__) + ", " + 'item=' + (repr(item) if type(item) in (str, int, float, bytes, bool, type(None)) or (type(item) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in item)) else item.__name__ if type(item) is type else type(item).__name__) + '] =>', item)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: item')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for row in swallowed():')


# ---- Kept by the interpreter after the handler ----

try:
    def last_exception():
        try:
            try:
                raise KeyError('first')
            except KeyError:
                raise ValueError('second')
        except ValueError:
            text = traceback.format_exc()
        return [line.strip() for line in text.split('\n') if line.startswith(('  File', 'KeyError', 'ValueError', 'During'))].__len__(), sys.exception()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def last_exception():')


try: print(last_exception())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: last_exception()')
