# sys.monitoring: a tool answers DISABLE when it is told of a call of a function that is not written in Python. Is it told how that call ends?
#
# In CPython it is, as long as no event at a place in the code object has had more than one tool: until then it knows the tools of the code object only, and not those of each
# instruction. sys.setprofile() and sys.settrace() are tools too.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: M = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M = sys.monitoring')
try: E = M.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E = M.events')

try:
    def name(callable): return getattr(callable, '__name__', type(callable).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def name(callable): return getattr(callable, '__name__', type(callabl...")
try:
    def listen(tool, code, log, answer, label=''):
        def call(where, offset, callable, first):
            if where is code:
                log.append('%sCALL(%s)' % (label, name(callable)))
                return answer
        M.use_tool_id(tool, 't%d' % tool)
        M.register_callback(tool, E.CALL, call)
        M.register_callback(tool, E.C_RETURN, lambda where, offset, callable, first: log.append('%sC_RETURN(%s)' % (label, name(callable))) if where is code else None)
        M.register_callback(tool, E.C_RAISE, lambda where, offset, callable, first: log.append('%sC_RAISE(%s)' % (label, name(callable))) if where is code else None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def listen(tool, code, log, answer, label=''):")
try:
    def leave(tool, code):
        M.set_events(tool, 0); M.set_local_events(tool, code, 0); M.free_tool_id(tool)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def leave(tool, code):')
try:
    def function(expression):
        namespace = {}
        exec('def call(F, l):\n    return ' + expression, namespace)
        return namespace['call']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def function(expression):')
try:
    def run(call, F, log, times=2):
        for i in range(times):
            try: call(F, [[1, 2]])
            except TypeError: log.append('TypeError')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(call, F, log, times=2):')

try:
    class C:
        def __init__(self, x): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C:')
try:
    class S:
        def m(self): return 'S.m'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S:')
try:
    class T(S):
        def m(self): return super().m()
        def n(self): return super(T, self).m()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class T(S):')

try: print('One tool.')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'One tool.'")
try:
    for expression in ('F(l[0])', 'F(*l)', 'F(l[0], *())', 'F(l[0], **{})', 'l.append(F)', '[F(x) for x in l]'):
        for what, F in (('len', len), ('None', None), ('a class', C), ('iter', iter)):
            for local in (False, True):
                for answer in (None, M.DISABLE):
                    try: call = function(expression)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: call = function(expression)')
                    try: log = []
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
                    try: listen(2, call.__code__, log, answer)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: listen(2, call.__code__, log, answer)')
                    try: M.set_local_events(2, call.__code__, E.CALL) if local else M.set_events(2, E.CALL)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_local_events(2, call.__code__, E.CALL) if local else M.set_even...')
                    try: run(call, F, log)
                    finally: leave(2, call.__code__)
                    try: print("'%-18s %-8s %-10s %-8s %s' % (expression, what, 'here' if local else ... [" + 'expression=' + (repr(expression) if type(expression) in (str, int, float, bytes, bool, type(None)) or (type(expression) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in expression)) else expression.__name__ if type(expression) is type else type(expression).__name__) + ", " + 'what=' + (repr(what) if type(what) in (str, int, float, bytes, bool, type(None)) or (type(what) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in what)) else what.__name__ if type(what) is type else type(what).__name__) + ", " + 'F=' + (repr(F) if type(F) in (str, int, float, bytes, bool, type(None)) or (type(F) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in F)) else F.__name__ if type(F) is type else type(F).__name__) + ", " + 'local=' + (repr(local) if type(local) in (str, int, float, bytes, bool, type(None)) or (type(local) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in local)) else local.__name__ if type(local) is type else type(local).__name__) + ", " + 'answer=' + (repr(answer) if type(answer) in (str, int, float, bytes, bool, type(None)) or (type(answer) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in answer)) else answer.__name__ if type(answer) is type else type(answer).__name__) + '] =>', '%-18s %-8s %-10s %-8s %s' % (expression, what, 'here' if local else 'everywhere', 'DISABLE' if answer else 'None', ' '.join(log)))
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '%-18s %-8s %-10s %-8s %s' % (expression, what, 'here' if local else ...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for expression in ('F(l[0])', 'F(*l)', 'F(l[0], *())', 'F(l[0], **{})...")
try:
    for method in (T.m, T.n):
        for answer in (None, M.DISABLE):
            try: log = []
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
            try: listen(2, method.__code__, log, answer)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: listen(2, method.__code__, log, answer)')
            try: M.set_local_events(2, method.__code__, E.CALL)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_local_events(2, method.__code__, E.CALL)')
            try: method(T()); method(T())
            finally: leave(2, method.__code__)
            try: print('super', 'method.__name__ [' + 'method=' + (repr(method) if type(method) in (str, int, float, bytes, bool, type(None)) or (type(method) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in method)) else method.__name__ if type(method) is type else type(method).__name__) + ", " + 'answer=' + (repr(answer) if type(answer) in (str, int, float, bytes, bool, type(None)) or (type(answer) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in answer)) else answer.__name__ if type(answer) is type else type(answer).__name__) + '] =>', method.__name__)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: method.__name__')
            try: print("'DISABLE' if answer else 'None' [" + 'method=' + (repr(method) if type(method) in (str, int, float, bytes, bool, type(None)) or (type(method) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in method)) else method.__name__ if type(method) is type else type(method).__name__) + ", " + 'answer=' + (repr(answer) if type(answer) in (str, int, float, bytes, bool, type(None)) or (type(answer) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in answer)) else answer.__name__ if type(answer) is type else type(answer).__name__) + '] =>', 'DISABLE' if answer else 'None')
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'DISABLE' if answer else 'None'")
            try: print("' '.join(log) [" + 'method=' + (repr(method) if type(method) in (str, int, float, bytes, bool, type(None)) or (type(method) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in method)) else method.__name__ if type(method) is type else type(method).__name__) + ", " + 'answer=' + (repr(answer) if type(answer) in (str, int, float, bytes, bool, type(None)) or (type(answer) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in answer)) else answer.__name__ if type(answer) is type else type(answer).__name__) + '] =>', ' '.join(log))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ' '.join(log)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for method in (T.m, T.n):')

try: print('Another tool as well.')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'Another tool as well.'")
try: EVENTS = {'CALL': E.CALL, 'LINE': E.LINE, 'PY_START': E.PY_START, 'PY_RETURN': E.PY_RETURN, 'JUMP': E.JUMP, 'RAISE': E.RAISE, 'INSTRUCTION': E.INSTRUCTION}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: EVENTS = {'CALL': E.CALL, 'LINE': E.LINE, 'PY_START': E.PY_START, 'PY...")
try:
    for event_name, event in EVENTS.items():
        for ours in (E.CALL, E.CALL | E.LINE, E.CALL | E.PY_START):
            for local in (False, True):
                if local and event == E.RAISE: continue
                for other_answer in (None, M.DISABLE):
                    try: call = function('F(l[0])')
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: call = function('F(l[0])')")
                    try: log = []
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
                    try: listen(2, call.__code__, log, M.DISABLE)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: listen(2, call.__code__, log, M.DISABLE)')
                    try: listen(3, call.__code__, log, other_answer, 'other ')
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: listen(3, call.__code__, log, other_answer, 'other ')")
                    try: M.set_local_events(3, call.__code__, event) if local else M.set_events(3, event)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_local_events(3, call.__code__, event) if local else M.set_event...')
                    try: M.set_local_events(2, call.__code__, ours)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_local_events(2, call.__code__, ours)')
                    try: run(call, len, log)
                    finally: leave(2, call.__code__); leave(3, call.__code__)
                    try: print("'%-12s %-10s ours %-3d other answers %-8s %s' % (event_name, 'here' i... [" + 'event_name=' + (repr(event_name) if type(event_name) in (str, int, float, bytes, bool, type(None)) or (type(event_name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in event_name)) else event_name.__name__ if type(event_name) is type else type(event_name).__name__) + ", " + 'event=' + (repr(event) if type(event) in (str, int, float, bytes, bool, type(None)) or (type(event) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in event)) else event.__name__ if type(event) is type else type(event).__name__) + ", " + 'ours=' + (repr(ours) if type(ours) in (str, int, float, bytes, bool, type(None)) or (type(ours) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in ours)) else ours.__name__ if type(ours) is type else type(ours).__name__) + ", " + 'local=' + (repr(local) if type(local) in (str, int, float, bytes, bool, type(None)) or (type(local) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in local)) else local.__name__ if type(local) is type else type(local).__name__) + ", " + 'other_answer=' + (repr(other_answer) if type(other_answer) in (str, int, float, bytes, bool, type(None)) or (type(other_answer) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in other_answer)) else other_answer.__name__ if type(other_answer) is type else type(other_answer).__name__) + '] =>', '%-12s %-10s ours %-3d other answers %-8s %s' % (event_name, 'here' if local else 'everywhere', ours, 'DISABLE' if other_answer else 'None', ' '.join(log)))
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '%-12s %-10s ours %-3d other answers %-8s %s' % (event_name, 'here' i...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for event_name, event in EVENTS.items():')

try: print('Another tool that has gone.')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'Another tool that has gone.'")
try:
    for local in (False, True):
        for was_run in (False, True):
            try: call = function('F(l[0])')
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: call = function('F(l[0])')")
            try: log = []
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
            try: listen(2, call.__code__, log, M.DISABLE)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: listen(2, call.__code__, log, M.DISABLE)')
            try: listen(3, call.__code__, log, None, 'other ')
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: listen(3, call.__code__, log, None, 'other ')")
            try: M.set_local_events(3, call.__code__, E.LINE) if local else M.set_events(3, E.LINE)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_local_events(3, call.__code__, E.LINE) if local else M.set_even...')
            try: M.set_local_events(2, call.__code__, E.LINE)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_local_events(2, call.__code__, E.LINE)')
            if was_run: run(call, len, log, 1)
            try: M.set_events(3, 0)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(3, 0)')
            try: M.set_local_events(3, call.__code__, 0)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_local_events(3, call.__code__, 0)')
            try: M.set_local_events(2, call.__code__, E.CALL)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_local_events(2, call.__code__, E.CALL)')
            try: run(call, len, log)
            finally: leave(2, call.__code__); leave(3, call.__code__)
            try: print("'here' if local else 'everywhere' [" + 'local=' + (repr(local) if type(local) in (str, int, float, bytes, bool, type(None)) or (type(local) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in local)) else local.__name__ if type(local) is type else type(local).__name__) + ", " + 'was_run=' + (repr(was_run) if type(was_run) in (str, int, float, bytes, bool, type(None)) or (type(was_run) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in was_run)) else was_run.__name__ if type(was_run) is type else type(was_run).__name__) + '] =>', 'here' if local else 'everywhere')
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'here' if local else 'everywhere'")
            try: print("'and the function was called meanwhile:' if was_run else 'and the fun... [" + 'local=' + (repr(local) if type(local) in (str, int, float, bytes, bool, type(None)) or (type(local) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in local)) else local.__name__ if type(local) is type else type(local).__name__) + ", " + 'was_run=' + (repr(was_run) if type(was_run) in (str, int, float, bytes, bool, type(None)) or (type(was_run) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in was_run)) else was_run.__name__ if type(was_run) is type else type(was_run).__name__) + '] =>', 'and the function was called meanwhile:' if was_run else 'and the function was not called meanwhile:')
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'and the function was called meanwhile:' if was_run else 'and the fun...")
            try: print("' '.join(log) [" + 'local=' + (repr(local) if type(local) in (str, int, float, bytes, bool, type(None)) or (type(local) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in local)) else local.__name__ if type(local) is type else type(local).__name__) + ", " + 'was_run=' + (repr(was_run) if type(was_run) in (str, int, float, bytes, bool, type(None)) or (type(was_run) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in was_run)) else was_run.__name__ if type(was_run) is type else type(was_run).__name__) + '] =>', ' '.join(log))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ' '.join(log)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for local in (False, True):')

try: print('A profile function, a trace function.')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'A profile function, a trace function.'")
try:
    for set_function in (sys.setprofile, sys.settrace):
        try: call = function('F(l[0])')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: call = function('F(l[0])')")
        try: log = []
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
        try: listen(2, call.__code__, log, M.DISABLE)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: listen(2, call.__code__, log, M.DISABLE)')
        try: M.set_local_events(2, call.__code__, E.CALL)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_local_events(2, call.__code__, E.CALL)')
        def told(frame, event, argument):
            if frame.f_code is call.__code__: log.append(event)
            return told
        try: set_function(told)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: set_function(told)')
        try: run(call, len, log)
        finally: set_function(None); leave(2, call.__code__)
        try: print('set_function.__name__ [' + 'set_function=' + (repr(set_function) if type(set_function) in (str, int, float, bytes, bool, type(None)) or (type(set_function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in set_function)) else set_function.__name__ if type(set_function) is type else type(set_function).__name__) + '] =>', set_function.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: set_function.__name__')
        try: print("' '.join(log) [" + 'set_function=' + (repr(set_function) if type(set_function) in (str, int, float, bytes, bool, type(None)) or (type(set_function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in set_function)) else set_function.__name__ if type(set_function) is type else type(set_function).__name__) + '] =>', ' '.join(log))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ' '.join(log)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for set_function in (sys.setprofile, sys.settrace):')

try: print('The function that is called changes what is wanted.')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'The function that is called changes what is wanted.'")
try:
    for change in ('nothing here', 'nothing anywhere', 'frees the tool', 'restarts'):
        try: log = []
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
        class Changes:
            def __len__(self):
                if change == 'nothing here': M.set_local_events(2, call.__code__, 0)
                elif change == 'nothing anywhere': M.set_events(2, 0)
                elif change == 'frees the tool':
                    if M.get_tool(2): M.free_tool_id(2)
                else: M.restart_events()
                return 0
        try: call = function('F(l)')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: call = function('F(l)')")
        for everywhere in (False, True):
            for answer in (None, M.DISABLE):
                try: del log[:]
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del log[:]')
                try: listen(2, call.__code__, log, answer)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: listen(2, call.__code__, log, answer)')
                try: M.set_events(2, E.CALL) if everywhere else M.set_local_events(2, call.__code__, E.CALL)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(2, E.CALL) if everywhere else M.set_local_events(2, call...')
                try: call(len, Changes()); call(len, Changes())
                finally:
                    if M.get_tool(2): leave(2, call.__code__)
                try: print("'%-18s %-10s %-8s %s' % (change, 'everywhere' if everywhere else 'her... [" + 'change=' + (repr(change) if type(change) in (str, int, float, bytes, bool, type(None)) or (type(change) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in change)) else change.__name__ if type(change) is type else type(change).__name__) + ", " + 'everywhere=' + (repr(everywhere) if type(everywhere) in (str, int, float, bytes, bool, type(None)) or (type(everywhere) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in everywhere)) else everywhere.__name__ if type(everywhere) is type else type(everywhere).__name__) + ", " + 'answer=' + (repr(answer) if type(answer) in (str, int, float, bytes, bool, type(None)) or (type(answer) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in answer)) else answer.__name__ if type(answer) is type else type(answer).__name__) + '] =>', '%-18s %-10s %-8s %s' % (change, 'everywhere' if everywhere else 'here', 'DISABLE' if answer else 'None', ' '.join(log)))
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '%-18s %-10s %-8s %s' % (change, 'everywhere' if everywhere else 'her...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for change in ('nothing here', 'nothing anywhere', 'frees the tool', ...")
