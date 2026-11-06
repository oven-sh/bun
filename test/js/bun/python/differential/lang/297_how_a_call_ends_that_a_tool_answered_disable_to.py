# sys.monitoring: a tool answers DISABLE when it is told of a call of a function that is not written in Python. Is it told how that call ends?
#
# In CPython it is, as long as no event at a place in the code object has had more than one tool: until then it knows the tools of the code object only, and not those of each
# instruction. sys.setprofile() and sys.settrace() are tools too.
import sys
M = sys.monitoring; E = M.events

def name(callable): return getattr(callable, '__name__', type(callable).__name__)
def listen(tool, code, log, answer, label=''):
    def call(where, offset, callable, first):
        if where is code:
            log.append('%sCALL(%s)' % (label, name(callable)))
            return answer
    M.use_tool_id(tool, 't%d' % tool)
    M.register_callback(tool, E.CALL, call)
    M.register_callback(tool, E.C_RETURN, lambda where, offset, callable, first: log.append('%sC_RETURN(%s)' % (label, name(callable))) if where is code else None)
    M.register_callback(tool, E.C_RAISE, lambda where, offset, callable, first: log.append('%sC_RAISE(%s)' % (label, name(callable))) if where is code else None)
def leave(tool, code):
    M.set_events(tool, 0); M.set_local_events(tool, code, 0); M.free_tool_id(tool)
def function(expression):
    namespace = {}
    exec('def call(F, l):\n    return ' + expression, namespace)
    return namespace['call']
def run(call, F, log, times=2):
    for i in range(times):
        try: call(F, [[1, 2]])
        except TypeError: log.append('TypeError')

class C:
    def __init__(self, x): pass
class S:
    def m(self): return 'S.m'
class T(S):
    def m(self): return super().m()
    def n(self): return super(T, self).m()

print('One tool.')
for expression in ('F(l[0])', 'F(*l)', 'F(l[0], *())', 'F(l[0], **{})', 'l.append(F)', '[F(x) for x in l]'):
    for what, F in (('len', len), ('None', None), ('a class', C), ('iter', iter)):
        for local in (False, True):
            for answer in (None, M.DISABLE):
                call = function(expression); log = []
                listen(2, call.__code__, log, answer)
                M.set_local_events(2, call.__code__, E.CALL) if local else M.set_events(2, E.CALL)
                try: run(call, F, log)
                finally: leave(2, call.__code__)
                print('%-18s %-8s %-10s %-8s %s' % (expression, what, 'here' if local else 'everywhere', 'DISABLE' if answer else 'None', ' '.join(log)))
for method in (T.m, T.n):
    for answer in (None, M.DISABLE):
        log = []
        listen(2, method.__code__, log, answer)
        M.set_local_events(2, method.__code__, E.CALL)
        try: method(T()); method(T())
        finally: leave(2, method.__code__)
        print('super', method.__name__, 'DISABLE' if answer else 'None', ' '.join(log))

print('Another tool as well.')
EVENTS = {'CALL': E.CALL, 'LINE': E.LINE, 'PY_START': E.PY_START, 'PY_RETURN': E.PY_RETURN, 'JUMP': E.JUMP, 'RAISE': E.RAISE, 'INSTRUCTION': E.INSTRUCTION}
for event_name, event in EVENTS.items():
    for ours in (E.CALL, E.CALL | E.LINE, E.CALL | E.PY_START):
        for local in (False, True):
            if local and event == E.RAISE: continue
            for other_answer in (None, M.DISABLE):
                call = function('F(l[0])'); log = []
                listen(2, call.__code__, log, M.DISABLE)
                listen(3, call.__code__, log, other_answer, 'other ')
                M.set_local_events(3, call.__code__, event) if local else M.set_events(3, event)
                M.set_local_events(2, call.__code__, ours)
                try: run(call, len, log)
                finally: leave(2, call.__code__); leave(3, call.__code__)
                print('%-12s %-10s ours %-3d other answers %-8s %s' % (event_name, 'here' if local else 'everywhere', ours, 'DISABLE' if other_answer else 'None', ' '.join(log)))

print('Another tool that has gone.')
for local in (False, True):
    for was_run in (False, True):
        call = function('F(l[0])'); log = []
        listen(2, call.__code__, log, M.DISABLE)
        listen(3, call.__code__, log, None, 'other ')
        M.set_local_events(3, call.__code__, E.LINE) if local else M.set_events(3, E.LINE)
        M.set_local_events(2, call.__code__, E.LINE)
        if was_run: run(call, len, log, 1)
        M.set_events(3, 0); M.set_local_events(3, call.__code__, 0)
        M.set_local_events(2, call.__code__, E.CALL)
        try: run(call, len, log)
        finally: leave(2, call.__code__); leave(3, call.__code__)
        print('here' if local else 'everywhere', 'and the function was called meanwhile:' if was_run else 'and the function was not called meanwhile:', ' '.join(log))

print('A profile function, a trace function.')
for set_function in (sys.setprofile, sys.settrace):
    call = function('F(l[0])'); log = []
    listen(2, call.__code__, log, M.DISABLE)
    M.set_local_events(2, call.__code__, E.CALL)
    def told(frame, event, argument):
        if frame.f_code is call.__code__: log.append(event)
        return told
    set_function(told)
    try: run(call, len, log)
    finally: set_function(None); leave(2, call.__code__)
    print(set_function.__name__, ' '.join(log))

print('The function that is called changes what is wanted.')
for change in ('nothing here', 'nothing anywhere', 'frees the tool', 'restarts'):
    log = []
    class Changes:
        def __len__(self):
            if change == 'nothing here': M.set_local_events(2, call.__code__, 0)
            elif change == 'nothing anywhere': M.set_events(2, 0)
            elif change == 'frees the tool':
                if M.get_tool(2): M.free_tool_id(2)
            else: M.restart_events()
            return 0
    call = function('F(l)')
    for everywhere in (False, True):
        for answer in (None, M.DISABLE):
            del log[:]
            listen(2, call.__code__, log, answer)
            M.set_events(2, E.CALL) if everywhere else M.set_local_events(2, call.__code__, E.CALL)
            try: call(len, Changes()); call(len, Changes())
            finally:
                if M.get_tool(2): leave(2, call.__code__)
            print('%-18s %-10s %-8s %s' % (change, 'everywhere' if everywhere else 'here', 'DISABLE' if answer else 'None', ' '.join(log)))
