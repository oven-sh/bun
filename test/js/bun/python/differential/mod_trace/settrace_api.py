# The rules of sys.settrace(): what is called with what, and what its result is for.
import sys


def show(*args):
    print(*args)


def f():
    x = 1
    y = 2
    return x


# A global function that returns None: only 'call'.
events = []
def only_calls(frame, event, arg):
    events.append((frame.f_code.co_name, event))
sys.settrace(only_calls)
f()
sys.settrace(None)
show(events)

# gettrace
show(sys.gettrace())
sys.settrace(only_calls)
show(sys.gettrace() is only_calls)
sys.settrace(None)
show(sys.gettrace())

# The local function is what the global one returns, and then what the local one returns.
events = []
def local_b(frame, event, arg):
    events.append(('b', event, frame.f_lineno - frame.f_code.co_firstlineno))
    return local_b
def local_a(frame, event, arg):
    events.append(('a', event, frame.f_lineno - frame.f_code.co_firstlineno))
    return local_b
def global_function(frame, event, arg):
    events.append(('g', event, frame.f_lineno - frame.f_code.co_firstlineno))
    return local_a
sys.settrace(global_function)
f()
sys.settrace(None)
show(events)

# A local function that returns None stays.
events = []
def local_none(frame, event, arg):
    events.append((event, frame.f_lineno - frame.f_code.co_firstlineno))
def global_function(frame, event, arg):
    return local_none
sys.settrace(global_function)
f()
sys.settrace(None)
show(events)

# f_trace
events = []
def local(frame, event, arg):
    events.append((event, frame.f_lineno - frame.f_code.co_firstlineno))
    return local
def global_function(frame, event, arg):
    show('f_trace at call', frame.f_trace)
    return local
def g():
    frame = sys._getframe()
    show('f_trace is local', frame.f_trace is local)
    frame.f_trace = None
    x = 1
    frame.f_trace = local
    y = 2
    del frame.f_trace
    z = 3
sys.settrace(global_function)
g()
sys.settrace(None)
show(events)

# f_trace_lines
events = []
def global_function(frame, event, arg):
    frame.f_trace_lines = False
    return local
sys.settrace(global_function)
f()
sys.settrace(None)
show(events)
frame = sys._getframe()
show(frame.f_trace_lines, frame.f_trace_opcodes, frame.f_trace)
for value in (1, None, 'x'):
    try:
        frame.f_trace_lines = value
    except TypeError as e:
        show('TypeError', e)
    try:
        frame.f_trace_opcodes = value
    except TypeError as e:
        show('TypeError', e)
try:
    del frame.f_trace_lines
except TypeError as e:
    show('TypeError', e)

# An exception in the trace function: tracing is switched off, and the exception goes on.
def failing(frame, event, arg):
    if event == 'line':
        raise RuntimeError('in the trace function')
    return failing
sys.settrace(failing)
try:
    f()
except RuntimeError as e:
    show('caught', e, sys.gettrace())
sys.settrace(None)

def failing_at_call(frame, event, arg):
    raise RuntimeError('at call')
sys.settrace(failing_at_call)
try:
    f()
except RuntimeError as e:
    show('caught', e, sys.gettrace())
sys.settrace(None)

def failing_at_return(frame, event, arg):
    if event == 'return':
        raise RuntimeError('at return')
    return failing_at_return
sys.settrace(failing_at_return)
try:
    f()
except RuntimeError as e:
    show('caught', e, sys.gettrace())
sys.settrace(None)

# Nothing is traced inside the trace function.
events = []
def helper():
    return 1
def with_helper(frame, event, arg):
    helper()
    events.append((frame.f_code.co_name, event))
    return with_helper
sys.settrace(with_helper)
f()
sys.settrace(None)
show(events)

# Switching it on in a frame that is running: that frame is not traced, unless it has f_trace; callers neither.
events = []
def local(frame, event, arg):
    events.append((frame.f_code.co_name, event, frame.f_lineno - frame.f_code.co_firstlineno))
    return local
def start_here():
    sys.settrace(local)
    x = 1
    f()
    y = 2
def caller():
    start_here()
    z = 3
caller()
sys.settrace(None)
show(events)

events = []
def start_with_f_trace():
    sys.settrace(local)
    sys._getframe().f_trace = local
    x = 1
    y = 2
start_with_f_trace()
sys.settrace(None)
show(events)

# Switching it off in the middle.
events = []
def stop_here():
    x = 1
    sys.settrace(None)
    y = 2
sys.settrace(local)
stop_here()
show(events, sys.gettrace())

# Writing to the variables of the frame.
def change(frame, event, arg):
    if event == 'line' and frame.f_lineno - frame.f_code.co_firstlineno == 2:
        frame.f_locals['x'] = 'changed'
        frame.f_locals['new'] = 'extra'
    return change
def changed():
    x = 1
    return x, sorted(sys._getframe().f_locals)
sys.settrace(change)
result = changed()
sys.settrace(None)
show(result)

# f_lineno outside a trace function
try:
    sys._getframe().f_lineno = 1
except ValueError as e:
    show('ValueError', e)
try:
    sys._getframe().f_lineno = 'a'
except ValueError as e:
    show('ValueError', e)
try:
    del sys._getframe().f_lineno
except AttributeError as e:
    show('AttributeError', e)

# Not callable
sys.settrace(1)
try:
    f()
except TypeError as e:
    show('TypeError', e, sys.gettrace())
sys.settrace(None)

# call_tracing
events = []
def traced_inside():
    return 1
def with_call_tracing(frame, event, arg):
    events.append((frame.f_code.co_name, event))
    if frame.f_code.co_name == 'f' and event == 'call':
        sys.call_tracing(traced_inside, ())
    return None
sys.settrace(with_call_tracing)
f()
sys.settrace(None)
show(events)

# Module and class code
events = []
def names(frame, event, arg):
    events.append((frame.f_code.co_name, event, frame.f_lineno))
    return names
sys.settrace(names)
exec(compile('a = 1\nclass C:\n    b = 2\n', '<test>', 'exec'), {})
sys.settrace(None)
show([e for e in events if e[0] in ('<module>', 'C')])
