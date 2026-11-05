# throw() into a generator, a coroutine or an asynchronous generator that has not started: it starts, and that is as far as it gets.
# Tools are told, the traceback has its frame, and the frame has the arguments.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: import traceback
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import traceback')
try: import warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import warnings')

try: M = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M = sys.monitoring')
try: E = M.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E = M.events')


try:
    def g(a=1, *rest, k=2):
        b = a
        try:
            yield 1
        except KeyError:
            yield 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g(a=1, *rest, k=2):')


try:
    def with_cell(a, b):
        def inner():
            return a
        yield inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def with_cell(a, b):')


try:
    def outer(free):
        def closes_over(x):
            yield free, x
        return closes_over
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer(free):')


try:
    async def co(a):
        return a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def co(a):')


try:
    async def ag(a):
        yield a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def ag(a):')


try:
    def delegating(a):
        yield from g(a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def delegating(a):')


try:
    def genexpr():
        return (x for x in [1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def genexpr():')


try:
    class Thrown(Exception):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Thrown(Exception):')


try: MAKERS = [
    ('generator', lambda: g(5, 6, k=7)),
    ('cell', lambda: with_cell(1, 2)),
    ('closure', lambda: outer('f')(3)),
    ('coroutine', lambda: co(4)),
    ('delegating', lambda: delegating(8)),
    ('genexpr', genexpr),
]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: MAKERS = [ ('generator', lambda: g(5, 6, k=7)), ('cell', lambda: with...")


try:
    def entries(exception):
        return [(frame.f_code.co_name, line) for frame, line in traceback.walk_tb(exception.__traceback__)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def entries(exception):')


try:
    def variables(frame):
        return sorted((name, type(value).__name__ if name == '.0' else value) for name, value in frame.f_locals.items() if not callable(value))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def variables(frame):')


try: print('== the traceback, and what the frame in it has')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '== the traceback, and what the frame in it has'")
try:
    for label, make in MAKERS:
        try: x = make()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = make()')
        try:
            x.throw(Thrown('t'))
        except Thrown as e:
            last = e.__traceback__
            while last.tb_next:
                last = last.tb_next
            print('label [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', label)
            print('entries(e)[1:] [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', entries(e)[1:])
            print('variables(last.tb_frame) [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', variables(last.tb_frame))
            print('last.tb_frame.f_back [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', last.tb_frame.f_back)
        for attribute in ('gi_frame', 'cr_frame', 'gi_running', 'cr_running', 'gi_suspended', 'cr_suspended'):
            if hasattr(x, attribute):
                try: print('   ', 'attribute [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + ", " + 'attribute=' + (repr(attribute) if type(attribute) in (str, int, float, bytes, bool, type(None)) or (type(attribute) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in attribute)) else attribute.__name__ if type(attribute) is type else type(attribute).__name__) + '] =>', attribute)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: attribute')
                try: print('getattr(x, attribute) [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + ", " + 'attribute=' + (repr(attribute) if type(attribute) in (str, int, float, bytes, bool, type(None)) or (type(attribute) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in attribute)) else attribute.__name__ if type(attribute) is type else type(attribute).__name__) + '] =>', getattr(x, attribute))
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: getattr(x, attribute)')
        try:
            print('    again', 'x.send(None) [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', x.send(None))
        except BaseException as e:
            print('    again', 'type(e).__name__ [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', type(e).__name__)
            print('e [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for label, make in MAKERS:')

try: print('== the frame object that was there before')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '== the frame object that was there before'")
try: x = g(5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = g(5)')
try: frame = x.gi_frame
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frame = x.gi_frame')
try: print('frame.f_lineno =>', frame.f_lineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frame.f_lineno')
try: print('variables(frame) =>', variables(frame))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: variables(frame)')
try:
    try:
        x.throw(Thrown)
    except Thrown as e:
        print('e.__traceback__.tb_next.tb_frame is frame =>', e.__traceback__.tb_next.tb_frame is frame)
        print('variables(frame) =>', variables(frame))
        print('frame.f_back =>', frame.f_back)
        print('e.__traceback__.tb_next.tb_lineno =>', e.__traceback__.tb_next.tb_lineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')

try: print('== an exception with a traceback of its own, and one with a context')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '== an exception with a traceback of its own, and one with a context'")
try:
    try:
        1 / 0
    except ZeroDivisionError as z:
        saved = z
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: x = g()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = g()')
try:
    try:
        x.throw(saved)
    except ZeroDivisionError as e:
        print(entries(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: x = g()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = g()')
try:
    try:
        try:
            raise KeyError('handled')
        except KeyError:
            x.throw(Thrown('in a handler'))
    except Thrown as e:
        print('repr(e.__context__) =>', repr(e.__context__))
        print('entries(e) =>', entries(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')

try: print('== StopIteration, GeneratorExit')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '== StopIteration, GeneratorExit'")
try:
    for exception in (StopIteration('s'), GeneratorExit('x'), StopAsyncIteration('a')):
        for label, make in MAKERS[:1] + MAKERS[3:4]:
            try: x = make()
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = make()')
            try:
                print('label [' + 'exception=' + (repr(exception) if type(exception) in (str, int, float, bytes, bool, type(None)) or (type(exception) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in exception)) else exception.__name__ if type(exception) is type else type(exception).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', label)
                print('x.throw(exception) [' + 'exception=' + (repr(exception) if type(exception) in (str, int, float, bytes, bool, type(None)) or (type(exception) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in exception)) else exception.__name__ if type(exception) is type else type(exception).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', x.throw(exception))
            except BaseException as e:
                print('label [' + 'exception=' + (repr(exception) if type(exception) in (str, int, float, bytes, bool, type(None)) or (type(exception) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in exception)) else exception.__name__ if type(exception) is type else type(exception).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', label)
                print('type(e).__name__ [' + 'exception=' + (repr(exception) if type(exception) in (str, int, float, bytes, bool, type(None)) or (type(exception) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in exception)) else exception.__name__ if type(exception) is type else type(exception).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', type(e).__name__)
                print('e [' + 'exception=' + (repr(exception) if type(exception) in (str, int, float, bytes, bool, type(None)) or (type(exception) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in exception)) else exception.__name__ if type(exception) is type else type(exception).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', e)
                print('repr(e.__cause__) [' + 'exception=' + (repr(exception) if type(exception) in (str, int, float, bytes, bool, type(None)) or (type(exception) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in exception)) else exception.__name__ if type(exception) is type else type(exception).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', repr(e.__cause__))
                print('entries(e)[1:] [' + 'exception=' + (repr(exception) if type(exception) in (str, int, float, bytes, bool, type(None)) or (type(exception) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in exception)) else exception.__name__ if type(exception) is type else type(exception).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', entries(e)[1:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for exception in (StopIteration('s'), GeneratorExit('x'), StopAsyncIt...")

try: print('== sys.monitoring')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '== sys.monitoring'")
try: names = {getattr(E, name): name for name in dir(E) if not name.startswith('_') and name not in ('NO_EVENTS', 'BRANCH')}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names = {getattr(E, name): name for name in dir(E) if not name.starts...')
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')


try:
    def callback(event):
        def told(code, *arguments):
            if code.co_filename == __file__ and code.co_name not in ('<lambda>', '<module>', 'outer'):
                log.append((names[event], code.co_name) + tuple(type(a).__name__ for a in arguments[1:]))
        return told
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def callback(event):')


try: M.use_tool_id(1, 'test')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.use_tool_id(1, 'test')")
try: wanted = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: wanted = 0')
try:
    for event, name in names.items():
        if name in ('INSTRUCTION', 'C_RETURN', 'C_RAISE', 'CALL', 'JUMP', 'BRANCH_LEFT', 'BRANCH_RIGHT'):
            continue
        try: M.register_callback(1, event, callback(event))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.register_callback(1, event, callback(event))')
        try: wanted |= event
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: wanted |= event')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for event, name in names.items():')
try:
    for label, make in MAKERS:
        try: x = make()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = make()')
        try: log.clear()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
        try: M.set_events(1, wanted)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, wanted)')
        try:
            x.throw(Thrown)
        except Thrown:
            pass
        try: M.set_events(1, 0)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, 0)')
        try: print('label [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', label)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: label')
        try: print('log [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', log)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for label, make in MAKERS:')
try: print('local events')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'local events'")
try:
    for label, make in MAKERS[:1]:
        try: x = make()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = make()')
        try: log.clear()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
        try: M.set_local_events(1, g.__code__, E.PY_START | E.PY_RESUME | E.LINE | E.PY_RETURN | E.PY_YIELD)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_local_events(1, g.__code__, E.PY_START | E.PY_RESUME | E.LINE |...')
        try: M.set_events(1, E.PY_THROW | E.RAISE | E.PY_UNWIND)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, E.PY_THROW | E.RAISE | E.PY_UNWIND)')
        try:
            x.throw(Thrown)
        except Thrown:
            pass
        try: M.set_events(1, 0)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, 0)')
        try: M.set_local_events(1, g.__code__, 0)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_local_events(1, g.__code__, 0)')
        try: print('label [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', label)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: label')
        try: print('log [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', log)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for label, make in MAKERS[:1]:')
try: print('a callback that raises')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'a callback that raises'")


try:
    def raises(code, offset, exception):
        raise LookupError('from the tool')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raises(code, offset, exception):')


try: M.register_callback(1, E.PY_THROW, raises)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.register_callback(1, E.PY_THROW, raises)')
try: M.set_events(1, E.PY_THROW)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, E.PY_THROW)')
try: x = g()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = g()')
try:
    try:
        x.throw(Thrown('t'))
    except BaseException as e:
        M.set_events(1, 0)
        print('type(e).__name__ =>', type(e).__name__)
        print('e =>', e)
        print('repr(e.__context__) =>', repr(e.__context__))
        print('[name for name, line in entries(e)] =>', [name for name, line in entries(e)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: M.set_events(1, 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, 0)')
try: print(x.gi_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.gi_frame')
try: M.free_tool_id(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.free_tool_id(1)')

try: print('== sys.settrace, sys.setprofile')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '== sys.settrace, sys.setprofile'")
try:
    for setter in (sys.settrace, sys.setprofile):
        for label, make in MAKERS:
            try: events = []
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: events = []')

            def tool(frame, event, argument):
                if frame.f_code.co_filename == __file__ and frame.f_code.co_name not in ('<lambda>', '<module>', 'outer'):
                    back = frame.f_back.f_code.co_name if frame.f_back else None
                    events.append((event, frame.f_code.co_name, frame.f_lineno, back, variables(frame), argument[0].__name__ if isinstance(argument, tuple) else argument))
                return tool

            try: x = make()
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = make()')
            try: setter(tool)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setter(tool)')
            try:
                x.throw(Thrown)
            except Thrown:
                pass
            try: setter(None)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setter(None)')
            try: print('setter.__name__ [' + 'setter=' + (repr(setter) if type(setter) in (str, int, float, bytes, bool, type(None)) or (type(setter) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in setter)) else setter.__name__ if type(setter) is type else type(setter).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', setter.__name__)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setter.__name__')
            try: print('label [' + 'setter=' + (repr(setter) if type(setter) in (str, int, float, bytes, bool, type(None)) or (type(setter) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in setter)) else setter.__name__ if type(setter) is type else type(setter).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + '] =>', label)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: label')
            for event in events:
                try: print('   ', 'event [' + 'setter=' + (repr(setter) if type(setter) in (str, int, float, bytes, bool, type(None)) or (type(setter) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in setter)) else setter.__name__ if type(setter) is type else type(setter).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'make=' + (repr(make) if type(make) in (str, int, float, bytes, bool, type(None)) or (type(make) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in make)) else make.__name__ if type(make) is type else type(make).__name__) + ", " + 'event=' + (repr(event) if type(event) in (str, int, float, bytes, bool, type(None)) or (type(event) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in event)) else event.__name__ if type(event) is type else type(event).__name__) + '] =>', event)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: event')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for setter in (sys.settrace, sys.setprofile):')

try: print('== asynchronous generators')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '== asynchronous generators'")


try:
    def drive(awaitable):
        try:
            awaitable.send(None)
        except BaseException as e:
            return type(e).__name__, str(e), entries(e)[1:]
        return 'yielded'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def drive(awaitable):')


try: a = ag(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = ag(1)')
try: print("drive(a.athrow(Thrown('t'))) =>", drive(a.athrow(Thrown('t'))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: drive(a.athrow(Thrown('t')))")
try: print('a.ag_frame =>', a.ag_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.ag_frame')
try: print('a.ag_running =>', a.ag_running)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.ag_running')
try: print(drive(a.asend(None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: drive(a.asend(None))')
try: a = ag(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = ag(1)')
try: print('drive(a.aclose()) =>', drive(a.aclose()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: drive(a.aclose())')
try: print('a.ag_frame =>', a.ag_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.ag_frame')
try: a = ag(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = ag(1)')
try: print('drive(a.athrow(GeneratorExit)) =>', drive(a.athrow(GeneratorExit)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: drive(a.athrow(GeneratorExit))')
try: print('a.ag_frame =>', a.ag_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.ag_frame')

try: print('== a coroutine that something was thrown into has been awaited')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '== a coroutine that something was thrown into has been awaited'")
try:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        c = co(1)
        try:
            c.throw(Thrown)
        except Thrown:
            pass
        del c
        import gc
        gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with warnings.catch_warnings(record=True) as caught:')
try: print([str(w.message) for w in caught])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [str(w.message) for w in caught]')

try: print('== close() is another matter: nobody is told, nothing is run')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '== close() is another matter: nobody is told, nothing is run'")
try: events = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: events = []')
try: sys.settrace(lambda frame, event, argument: events.append((event, frame.f_code.co_name)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(lambda frame, event, argument: events.append((event, fra...')
try: x = g()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = g()')
try: x.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.close()')
try: sys.settrace(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(None)')
try: print('events =>', events)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: events')
try: print('x.gi_frame =>', x.gi_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.gi_frame')

try: print('== through yield from, next to a delegate that has not started')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '== through yield from, next to a delegate that has not started'")


try:
    def late():
        inner = g(9)
        yield 'first'
        yield from inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def late():')


try: x = late()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = late()')
try: next(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(x)')
try:
    try:
        x.throw(Thrown)
    except Thrown as e:
        print(entries(e)[1:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')

try: print('== a generator expression is passed what was written')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '== a generator expression is passed what was written'")
try: one = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: one = 1')
try:
    for label, expression in [('list', (x for x in [1, 2])), ('set', (x for x in {1, 2})), ('names', (x for x in [one, one])), ('empty', (x for x in [])),
                              ('tuple', (x for x in (1, 2))), ('inner', (y for x in (1,) for y in [1, 2]))]:
        try: print('label [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'expression=' + (repr(expression) if type(expression) in (str, int, float, bytes, bool, type(None)) or (type(expression) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in expression)) else expression.__name__ if type(expression) is type else type(expression).__name__) + '] =>', label)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: label')
        try: print('[(name, type(value).__name__, value) for name, value in expression.gi... [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'expression=' + (repr(expression) if type(expression) in (str, int, float, bytes, bool, type(None)) or (type(expression) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in expression)) else expression.__name__ if type(expression) is type else type(expression).__name__) + '] =>', [(name, type(value).__name__, value) for name, value in expression.gi_frame.f_locals.items()])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [(name, type(value).__name__, value) for name, value in expression.gi...')
        try: print('expression.gi_code.co_consts [' + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'expression=' + (repr(expression) if type(expression) in (str, int, float, bytes, bool, type(None)) or (type(expression) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in expression)) else expression.__name__ if type(expression) is type else type(expression).__name__) + '] =>', expression.gi_code.co_consts)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: expression.gi_code.co_consts')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for label, expression in [('list', (x for x in [1, 2])), ('set', (x f...")


try:
    def constants(function):
        return [constant for constant in function.__code__.co_consts if not hasattr(constant, 'co_code')]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def constants(function):')


try: print('constants(lambda: (x for x in [1, 2])) =>', constants(lambda: (x for x in [1, 2])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: constants(lambda: (x for x in [1, 2]))')
try: print('constants(lambda: [x for x in [1, 2]]) =>', constants(lambda: [x for x in [1, 2]]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: constants(lambda: [x for x in [1, 2]])')
try: print('constants(lambda: {x for x in {1, 2}}) =>', constants(lambda: {x for x in {1, 2}}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: constants(lambda: {x for x in {1, 2}})')
try: print('constants(lambda: (x for x in {1, 2})) =>', constants(lambda: (x for x in {1, 2})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: constants(lambda: (x for x in {1, 2}))')
try: print('constants(lambda: sum(x for x in [1, 2])) =>', constants(lambda: sum(x for x in [1, 2])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: constants(lambda: sum(x for x in [1, 2]))')
try: print('constants(lambda: list(x for x in [1, 2])) =>', constants(lambda: list(x for x in [1, 2])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: constants(lambda: list(x for x in [1, 2]))')
try: print('constants(lambda: (x for x in [])) =>', constants(lambda: (x for x in [])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: constants(lambda: (x for x in []))')
try: print('constants(lambda: all(x for x in [1, 2])) =>', constants(lambda: all(x for x in [1, 2])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: constants(lambda: all(x for x in [1, 2]))')

try: print('== no instruction of it is run, and nothing of this shows where one is started in the usual way')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '== no instruction of it is run, and nothing of this shows where one ...")
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try: M.use_tool_id(1, 'test')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.use_tool_id(1, 'test')")
try: told_of = ('INSTRUCTION', 'LINE', 'PY_THROW', 'RAISE', 'PY_UNWIND', 'PY_START', 'JUMP', 'BRANCH_LEFT', 'BRANCH_RIGHT')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: told_of = ('INSTRUCTION', 'LINE', 'PY_THROW', 'RAISE', 'PY_UNWIND', '...")
try:
    for name in told_of:
        try: M.register_callback(1, getattr(E, name), lambda code, *arguments, name=name: log.append(name) if code is with_cell.__code__ else None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.register_callback(1, getattr(E, name), lambda code, *arguments, nam...')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name in told_of:')
try: M.set_events(1, sum(getattr(E, name) for name in told_of))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, sum(getattr(E, name) for name in told_of))')
try: x = with_cell(1, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = with_cell(1, 2)')
try:
    try:
        x.throw(Thrown)
    except Thrown:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: M.set_events(1, 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, 0)')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
try: M.set_events(1, sum(getattr(E, name) for name in told_of if name != 'INSTRUCTION'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.set_events(1, sum(getattr(E, name) for name in told_of if name != '...")
try: list(with_cell(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(with_cell(1, 2))')
try: M.set_events(1, 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, 0)')
try: M.free_tool_id(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.free_tool_id(1)')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')

try: print('== a trace function that raises when it is told of the call')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '== a trace function that raises when it is told of the call'")


try:
    def refuses(frame, event, argument):
        if frame.f_code is g.__code__:
            raise LookupError(event)
        return refuses
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def refuses(frame, event, argument):')


try: x = g()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = g()')
try: sys.settrace(refuses)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(refuses)')
try:
    try:
        x.throw(Thrown)
    except BaseException as e:
        sys.settrace(None)
        print('type(e).__name__ =>', type(e).__name__)
        print('e =>', e)
        print('repr(e.__context__) =>', repr(e.__context__))
        print('x.gi_frame =>', x.gi_frame)
        print('[name for name, line in entries(e)] =>', [name for name, line in entries(e)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: sys.settrace(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(None)')
