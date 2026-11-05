# The same under tools: when the generators are closed, among the events.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: from collections import deque
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from collections import deque')
try: from itertools import islice
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from itertools import islice')

try: EVENTS = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: EVENTS = []')


try:
    def g(name, n=5):
        try:
            for i in range(n):
                yield i
        finally:
            EVENTS.append('closed ' + name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g(name, n=5):')


try:
    def loop():
        for x in enumerate(g('a')):
            break
        EVENTS.append('after the loop')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop():')


try:
    def loop_over_two():
        for x in zip(g('a'), g('b')):
            break
        EVENTS.append('after the loop')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop_over_two():')


try:
    def function():
        next(map(str, g('a')))
        EVENTS.append('after next')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def function():')


try:
    def type_():
        list(islice(g('a'), 2))
        EVENTS.append('after list')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def type_():')


try:
    def two_levels():
        any(zip(enumerate(g('a')), g('b')))
        EVENTS.append('after any')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def two_levels():')


try:
    def method():
        ''.join(map(str, islice(g('a'), 2)))
        EVENTS.append('after join')
        [].extend(islice(g('a'), 2))
        EVENTS.append('after extend')
        deque(islice(g('a'), 2), 1).extend(islice(g('b'), 2))
        EVENTS.append('after deque')
        bytes(islice(g('a'), 2)) + b''.join(map(bytes, islice(g('b'), 2)))
        EVENTS.append('after bytes')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def method():')


try:
    def raises():
        try:
            ''.join(g('a'))
        except TypeError:
            EVENTS.append('in the handler')
        try:
            bytes(x * 200 for x in enumerate(g('a')))
        except TypeError:
            EVENTS.append('in the handler')
        try:
            a, b = enumerate(g('a'))
        except ValueError:
            EVENTS.append('in the handler')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raises():')


try:
    def unpacks():
        a, b = islice(g('a'), 2)
        EVENTS.append('after the assignment')
        a, *b = zip(g('a', 2), g('b'))
        EVENTS.append('after the assignment')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def unpacks():')


try:
    def identity(x):
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def identity(x):')


try:
    def elements_that_call():
        next(identity(x) for x in g('a'))
        EVENTS.append('after next')
        any(identity(x + 1) for x in g('a'))
        EVENTS.append('after any')
        for x in (identity(x) for x in g('a')):
            break
        EVENTS.append('after the loop')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def elements_that_call():')


try: FORMS = (loop, loop_over_two, function, type_, two_levels, method, raises, unpacks, elements_that_call)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: FORMS = (loop, loop_over_two, function, type_, two_levels, method, ra...')


try:
    def name_of(arg):
        return getattr(arg, '__qualname__', None) or type(arg).__name__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def name_of(arg):')


try:
    def profile(frame, event, arg):
        EVENTS.append((event, name_of(arg) if event.startswith('c_') else frame.f_code.co_name))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def profile(frame, event, arg):')


try:
    def trace(frame, event, arg):
        EVENTS.append((event, frame.f_code.co_name, frame.f_lineno - frame.f_code.co_firstlineno))
        return trace
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def trace(frame, event, arg):')


try:
    def report(what):
        print('--', what)
        for event in EVENTS:
            print('  ', event)
        EVENTS.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def report(what):')


try:
    for form in FORMS:
        try: form()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: form()')
        try: report(form.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: report(form.__name__)')
        try: sys.setprofile(profile)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.setprofile(profile)')
        try: form()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: form()')
        try: sys.setprofile(None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.setprofile(None)')
        try: report(form.__name__ + ', profiled')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: report(form.__name__ + ', profiled')")
        try: sys.settrace(trace)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(trace)')
        try: form()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: form()')
        try: sys.settrace(None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(None)')
        try: report(form.__name__ + ', traced')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: report(form.__name__ + ', traced')")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for form in FORMS:')

try: mon = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mon = sys.monitoring')
try: E = mon.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E = mon.events')
try: mon.use_tool_id(3, 'test')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: mon.use_tool_id(3, 'test')")
try:
    for event in (E.PY_START, E.PY_RETURN, E.PY_UNWIND, E.PY_THROW, E.PY_YIELD, E.PY_RESUME):
        def callback(code, offset, *args, name=event):
            EVENTS.append((name, code.co_name))
        try: mon.register_callback(3, event, callback)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mon.register_callback(3, event, callback)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for event in (E.PY_START, E.PY_RETURN, E.PY_UNWIND, E.PY_THROW, E.PY_...')
try:
    for form in FORMS:
        try: mon.set_events(3, E.PY_START | E.PY_RETURN | E.PY_UNWIND | E.PY_THROW | E.PY_YIELD | E.PY_RESUME)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mon.set_events(3, E.PY_START | E.PY_RETURN | E.PY_UNWIND | E.PY_THROW...')
        try: form()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: form()')
        try: mon.set_events(3, 0)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mon.set_events(3, 0)')
        try: report(form.__name__ + ', monitored')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: report(form.__name__ + ', monitored')")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for form in FORMS:')
