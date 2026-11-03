# sys.monitoring: tools, event sets, callbacks, and the errors of each function.
import sys

m = sys.monitoring
E = m.events


def attempt(function, *args):
    try:
        print(function.__name__, args if not any(callable(a) or hasattr(a, 'co_code') for a in args) else '...', '->', function(*args))
    except Exception as e:
        print(function.__name__, '->', type(e).__name__, e)


print(sorted(n for n in dir(m) if not n.startswith('__') and n != '_places'))
print(sorted((getattr(E, n), n) for n in dir(E) if not n.startswith('_')))
print(m.DEBUGGER_ID, m.COVERAGE_ID, m.PROFILER_ID, m.OPTIMIZER_ID)
print(type(m).__name__, m.__name__, repr(m.DISABLE)[:8], repr(m.MISSING)[:8])

for tool in (-1, 0, 5, 6, 7, 8, 'a', 1.5):
    attempt(m.get_tool, tool)
attempt(m.use_tool_id, 0, 'first')
attempt(m.get_tool, 0)
attempt(m.use_tool_id, 0, 'second')
attempt(m.use_tool_id, 1, 5)
attempt(m.use_tool_id, 6, 'x')
attempt(m.free_tool_id, 0)
attempt(m.get_tool, 0)
attempt(m.free_tool_id, 0)
attempt(m.free_tool_id, 9)
attempt(m.clear_tool_id, 0)
attempt(m.clear_tool_id, 9)

attempt(m.get_events, 0)
attempt(m.set_events, 0, E.LINE)
attempt(m.use_tool_id, 0, 'tool')
attempt(m.set_events, 0, E.LINE | E.PY_START)
attempt(m.get_events, 0)
attempt(m._all_events)
attempt(m.set_events, 0, E.C_RETURN)
attempt(m.set_events, 0, E.C_RAISE)
attempt(m.set_events, 0, E.CALL | E.C_RETURN | E.C_RAISE)
attempt(m.get_events, 0)
attempt(m.set_events, 0, E.BRANCH)
attempt(m.get_events, 0)
attempt(m.set_events, 0, -1)
attempt(m.set_events, 0, 1 << 19)
attempt(m.set_events, 0, 1 << 40)
attempt(m.set_events, 0, (1 << 19) - 1)
attempt(m.get_events, 0)
attempt(m.set_events, 0, 0)
attempt(m.set_events, 9, 0)
attempt(m.get_events, 9)


def f():
    pass


code = f.__code__
attempt(m.get_local_events, 0, code)
attempt(m.set_local_events, 0, code, E.LINE | E.PY_RETURN)
attempt(m.get_local_events, 0, code)
attempt(m.get_local_events, 1, code)
attempt(m.set_local_events, 1, code, E.LINE)
attempt(m.set_local_events, 0, f, E.LINE)
attempt(m.get_local_events, 0, f)
attempt(m.set_local_events, 0, code, E.C_RETURN)
attempt(m.set_local_events, 0, code, E.CALL | E.C_RETURN)
attempt(m.get_local_events, 0, code)
attempt(m.set_local_events, 0, code, E.RAISE | E.PY_UNWIND | E.RERAISE | E.EXCEPTION_HANDLED | E.PY_THROW)
attempt(m.get_local_events, 0, code)
attempt(m.set_local_events, 0, code, E.BRANCH)
attempt(m.get_local_events, 0, code)
attempt(m.set_local_events, 0, code, -1)
attempt(m.set_local_events, 0, code, 1 << 19)
attempt(m.set_local_events, 0, code, 0)
attempt(m.set_local_events, 9, code, 0)


def callback(*args):
    pass


def other(*args):
    pass


print(m.register_callback(0, E.LINE, callback))
print(m.register_callback(0, E.LINE, other) is callback)
print(m.register_callback(0, E.LINE, None) is other)
print(m.register_callback(0, E.LINE, None))
attempt(m.register_callback, 0, E.LINE | E.CALL, callback)
attempt(m.register_callback, 0, 0, callback)
attempt(m.register_callback, 0, 1 << 19, callback)
attempt(m.register_callback, 0, 1 << 25, callback)
attempt(m.register_callback, 9, E.LINE, callback)
attempt(m.register_callback, 3, E.LINE, callback)  # not in use: allowed
print(m.register_callback(3, E.LINE, None) is callback)
print(m.register_callback(0, E.C_RETURN, callback), m.register_callback(0, E.C_RAISE, callback), m.register_callback(0, E.BRANCH, callback))
print(m.register_callback(0, E.C_RETURN, None) is callback, m.register_callback(0, E.C_RAISE, None) is callback, m.register_callback(0, E.BRANCH, None) is callback)

# clear_tool_id takes away events and callbacks, and leaves the name.
m.set_events(0, E.LINE)
m.set_local_events(0, code, E.PY_START)
m.register_callback(0, E.LINE, callback)
m.clear_tool_id(0)
f()  # In CPython the events of a code object are cleared when it next runs.
print(m.get_tool(0), m.get_events(0), m.get_local_events(0, code), m.register_callback(0, E.LINE, None))
m.set_events(0, E.LINE)
m.set_local_events(0, code, E.PY_START)
m.register_callback(0, E.LINE, callback)
m.free_tool_id(0)
f()
print(m.get_tool(0), m.get_events(0), m.get_local_events(0, code), m.register_callback(0, E.LINE, None))
attempt(m.restart_events)
attempt(m._all_events)

# An audit event for callbacks
seen = []
sys.addaudithook(lambda name, args: seen.append((name, len(args))) if name.startswith(('sys.monitoring', 'sys.settrace', 'sys.setprofile')) else None)
m.register_callback(0, E.LINE, callback)
m.register_callback(0, E.LINE, None)
sys.settrace(None)
sys.setprofile(None)
print(seen)
