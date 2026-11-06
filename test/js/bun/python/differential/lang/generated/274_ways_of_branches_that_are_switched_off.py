# The two ways of a branch are switched off one by one: a tool that answers DISABLE is not told of that way again, at that branch, until
# restart_events(), and is still told of the other.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')

try: M = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M = sys.monitoring')
try: E = M.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E = M.events')


try:
    def for_loop(n):
        t = 0
        for i in range(n):
            t += i
        return t
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def for_loop(n):')


try:
    def for_break(n):
        for i in range(n):
            if i == 2:
                break
        n += i
        n += i
        return n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def for_break(n):')


try:
    def for_else(n):
        for i in range(n):
            if i == 7:
                break
        else:
            i = -1
        return i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def for_else(n):')


try:
    def for_continue(n):
        t = 0
        for i in range(n):
            if i % 2:
                continue
            t += i
        return t
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def for_continue(n):')


try:
    def while_loop(n):
        i = 0
        while i < n:
            i += 1
        return i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def while_loop(n):')


try:
    def while_else(n):
        i = 0
        while i < n:
            i += 1
        else:
            i = -i
        return i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def while_else(n):')


try:
    def while_true(n):
        i = 0
        while True:
            i += 1
            if i >= n:
                return i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def while_true(n):')


try:
    def if_else(n):
        t = 0
        for i in range(n):
            if i % 3:
                t += 1
            else:
                t -= 1
        return t
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def if_else(n):')


try:
    def if_only(n):
        t = 0
        for i in range(n):
            if i < 100:
                t += 1
        return t
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def if_only(n):')


try:
    def if_never(n):
        t = 0
        for i in range(n):
            if i > 100:
                t += 1
        return t
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def if_never(n):')


try:
    def if_last(n):
        for i in range(n):
            if i > 1:
                n = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def if_last(n):')


try:
    def elifs(n):
        t = 0
        for i in range(n):
            if i == 0:
                t += 1
            elif i == 1:
                t += 2
            elif i == 50:
                t += 3
            else:
                t += 4
        return t
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def elifs(n):')


try:
    def and_or(n):
        t = 0
        for i in range(n):
            if i and t or not t:
                t = 1 - t
        return t
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def and_or(n):')


try:
    def values(n):
        t = None
        for i in range(n):
            t = i and t
            t = t or i
        return t
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def values(n):')


try:
    def none_tests(n):
        t = None
        for i in range(n):
            if t is None:
                t = i
            if t is not None:
                t = t or None
        return t
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def none_tests(n):')


try:
    def nested(n):
        t = 0
        for i in range(n):
            for j in range(i):
                if j:
                    t += 1
        return t
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nested(n):')


try:
    def comprehension(n):
        return [i for i in range(n) if i % 2], {i: j for i in range(n) for j in range(2) if i if j}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def comprehension(n):')


try:
    def generator(n):
        def inner():
            for i in range(n):
                if i:
                    yield i
        return sum(inner()) + sum(i for i in range(n) if i > 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generator(n):')


try:
    def handlers(n):
        t = 0
        for i in range(n):
            try:
                if i == 1:
                    raise KeyError
                t += 1
            except KeyError:
                t -= 1
            except ValueError:
                t = 0
            finally:
                if t:
                    t += 10
                t += 1
        return t
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def handlers(n):')


try:
    def withs(n):
        class C:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return True
        t = 0
        for i in range(n):
            with C():
                if i == 1:
                    raise KeyError
                t += 1
        return t
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def withs(n):')


try:
    def matches(n):
        t = 0
        for i in range(n):
            match i:
                case 0:
                    t += 1
                case 1 | 2:
                    t += 2
                case int(x) if x > 50:
                    t += 3
                case _:
                    t += 4
        return t
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def matches(n):')


try:
    def one_line(n):
        for i in range(n): n = n and i
        return n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def one_line(n):')


try:
    def returns(n):
        for i in range(n):
            if i == 3: return i
        return -1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def returns(n):')


try: FUNCTIONS = [for_loop, for_break, for_else, for_continue, while_loop, while_else, while_true, if_else, if_only, if_never, if_last, elifs, and_or, values,
             none_tests, nested, comprehension, generator, handlers, withs, matches, one_line, returns]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: FUNCTIONS = [for_loop, for_break, for_else, for_continue, while_loop,...')
try: NAMES = {E.BRANCH_LEFT: 'L', E.BRANCH_RIGHT: 'R', E.LINE: 'line', E.JUMP: 'J'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: NAMES = {E.BRANCH_LEFT: 'L', E.BRANCH_RIGHT: 'R', E.LINE: 'line', E.J...")


try:
    def line_of(code, offset):
        for start, end, line in code.co_lines():
            if start <= offset < end:
                return line - code.co_firstlineno if line is not None else None
        return '?'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def line_of(code, offset):')


try:
    def run(function, tools, argument=5, times=1):
        """tools: {tool id: (events, what is answered DISABLE)}"""
        log = []

        def callback(tool, event, disabled):
            def told(code, *rest):
                if code.co_filename != __file__ or code.co_name in ('run', 'told'):
                    return None
                if event == E.LINE:
                    log.append((tool, 'line', rest[0] - code.co_firstlineno))
                else:
                    log.append((tool, NAMES[event], line_of(code, rest[0]), line_of(code, rest[1])))
                return M.DISABLE if event in disabled else None
            return told

        for tool, (events, disabled) in tools.items():
            M.use_tool_id(tool, 'test%d' % tool)
            wanted = 0
            for event in events:
                M.register_callback(tool, event, callback(tool, event, disabled))
                wanted |= event
            M.set_events(tool, wanted)
        results = []
        try:
            for _ in range(times):
                mark = len(log)
                function(argument)
                results.append(log[mark:])
        finally:
            for tool, (events, disabled) in tools.items():
                M.set_events(tool, 0)
                for event in events:
                    M.register_callback(tool, event, None)
                M.free_tool_id(tool)
        return results
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(function, tools, argument=5, times=1):')


try:
    def short(entries, with_tool=False):
        out = []
        for entry in entries:
            text = ''.join(str(part) if index != 2 else '>' + str(part) for index, part in enumerate(entry[1:])) if entry[1] != 'line' else str(entry[2])
            out.append(('%d:' % entry[0] if with_tool else '') + text)
        return ' '.join(out)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def short(entries, with_tool=False):')


try: BOTH = (E.BRANCH_LEFT, E.BRANCH_RIGHT)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: BOTH = (E.BRANCH_LEFT, E.BRANCH_RIGHT)')
try:
    for function in FUNCTIONS:
        try: print('==', 'function.__name__ [' + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', function.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: function.__name__')
        try: print('all    ', 'short(run(function, {1: (BOTH, ())})[0]) [' + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', short(run(function, {1: (BOTH, ())})[0]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(run(function, {1: (BOTH, ())})[0])')
        for label, disabled in (('no L   ', (E.BRANCH_LEFT,)), ('no R   ', (E.BRANCH_RIGHT,)), ('neither', BOTH)):
            try: first, second = run(function, {1: (BOTH, disabled)}, times=2)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first, second = run(function, {1: (BOTH, disabled)}, times=2)')
            try: print('label [' + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'disabled=' + (repr(disabled) if type(disabled) in (str, int, float, bytes, bool, type(None)) or (type(disabled) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in disabled)) else disabled.__name__ if type(disabled) is type else type(disabled).__name__) + '] =>', label)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: label')
            try: print('short(first) [' + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'disabled=' + (repr(disabled) if type(disabled) in (str, int, float, bytes, bool, type(None)) or (type(disabled) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in disabled)) else disabled.__name__ if type(disabled) is type else type(disabled).__name__) + '] =>', short(first))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(first)')
            try: print('|', 'short(second) [' + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + ", " + 'label=' + (repr(label) if type(label) in (str, int, float, bytes, bool, type(None)) or (type(label) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in label)) else label.__name__ if type(label) is type else type(label).__name__) + ", " + 'disabled=' + (repr(disabled) if type(disabled) in (str, int, float, bytes, bool, type(None)) or (type(disabled) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in disabled)) else disabled.__name__ if type(disabled) is type else type(disabled).__name__) + '] =>', short(second))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(second)')
        try: print('only L ', 'short(run(function, {1: ((E.BRANCH_LEFT,), ())})[0]) [' + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', short(run(function, {1: ((E.BRANCH_LEFT,), ())})[0]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(run(function, {1: ((E.BRANCH_LEFT,), ())})[0])')
        try: print('only R ', 'short(run(function, {1: ((E.BRANCH_RIGHT,), ())})[0]) [' + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', short(run(function, {1: ((E.BRANCH_RIGHT,), ())})[0]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(run(function, {1: ((E.BRANCH_RIGHT,), ())})[0])')
        try: print('lines  ', 'short(run(function, {1: (BOTH + (E.LINE,), ())})[0]) [' + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', short(run(function, {1: (BOTH + (E.LINE,), ())})[0]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(run(function, {1: (BOTH + (E.LINE,), ())})[0])')
        try: print('lines- ', 'short(run(function, {1: (BOTH + (E.LINE,), BOTH + (E.LINE,))})[0]) [' + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', short(run(function, {1: (BOTH + (E.LINE,), BOTH + (E.LINE,))})[0]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(run(function, {1: (BOTH + (E.LINE,), BOTH + (E.LINE,))})[0])')
        try: print('lines-L', 'short(run(function, {1: (BOTH + (E.LINE,), (E.BRANCH_LEFT, E.LINE))})... [' + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', short(run(function, {1: (BOTH + (E.LINE,), (E.BRANCH_LEFT, E.LINE))})[0]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(run(function, {1: (BOTH + (E.LINE,), (E.BRANCH_LEFT, E.LINE))})...')
        try: print('jumps  ', 'short(run(function, {1: (BOTH + (E.JUMP,), ())})[0]) [' + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', short(run(function, {1: (BOTH + (E.JUMP,), ())})[0]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(run(function, {1: (BOTH + (E.JUMP,), ())})[0])')
        try: print('jumps-R', 'short(run(function, {1: (BOTH + (E.JUMP,), (E.BRANCH_RIGHT,))})[0]) [' + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', short(run(function, {1: (BOTH + (E.JUMP,), (E.BRANCH_RIGHT,))})[0]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(run(function, {1: (BOTH + (E.JUMP,), (E.BRANCH_RIGHT,))})[0])')
        try: print('only J ', 'short(run(function, {1: ((E.JUMP,), ())})[0]) [' + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', short(run(function, {1: ((E.JUMP,), ())})[0]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(run(function, {1: ((E.JUMP,), ())})[0])')
        try: print('two    ', 'short(run(function, {1: (BOTH, BOTH), 2: (BOTH, ())})[0], True) [' + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', short(run(function, {1: (BOTH, BOTH), 2: (BOTH, ())})[0], True))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(run(function, {1: (BOTH, BOTH), 2: (BOTH, ())})[0], True)')
        try: print('two LR ', 'short(run(function, {1: (BOTH, (E.BRANCH_LEFT,)), 2: (BOTH, (E.BRANCH... [' + 'function=' + (repr(function) if type(function) in (str, int, float, bytes, bool, type(None)) or (type(function) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in function)) else function.__name__ if type(function) is type else type(function).__name__) + '] =>', short(run(function, {1: (BOTH, (E.BRANCH_LEFT,)), 2: (BOTH, (E.BRANCH_RIGHT,))})[0], True))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(run(function, {1: (BOTH, (E.BRANCH_LEFT,)), 2: (BOTH, (E.BRANCH...')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for function in FUNCTIONS:')

try: print('== restart_events()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '== restart_events()'")
try: M.use_tool_id(1, 'test')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.use_tool_id(1, 'test')")
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')


try:
    def told(name):
        def callback(code, source, destination):
            if code is if_else.__code__:
                log.append(name + str(line_of(code, source)) + '>' + str(line_of(code, destination)))
            return M.DISABLE
        return callback
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def told(name):')


try: M.register_callback(1, E.BRANCH_LEFT, told('L'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.register_callback(1, E.BRANCH_LEFT, told('L'))")
try: M.register_callback(1, E.BRANCH_RIGHT, told('R'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.register_callback(1, E.BRANCH_RIGHT, told('R'))")
try: M.set_events(1, E.BRANCH_LEFT | E.BRANCH_RIGHT)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, E.BRANCH_LEFT | E.BRANCH_RIGHT)')
try:
    for step in range(3):
        try: log.clear()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
        try: if_else(5)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if_else(5)')
        try: print('step [' + 'step=' + (repr(step) if type(step) in (str, int, float, bytes, bool, type(None)) or (type(step) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in step)) else step.__name__ if type(step) is type else type(step).__name__) + '] =>', step)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: step')
        try: print("' '.join(log) [" + 'step=' + (repr(step) if type(step) in (str, int, float, bytes, bool, type(None)) or (type(step) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in step)) else step.__name__ if type(step) is type else type(step).__name__) + '] =>', ' '.join(log))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ' '.join(log)")
        if step == 1:
            try: M.restart_events()
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.restart_events()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for step in range(3):')
try: print('in the middle of a loop')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'in the middle of a loop'")


try:
    def restarts(code, source, destination):
        if code is if_else.__code__:
            log.append('R' + str(line_of(code, source)) + '>' + str(line_of(code, destination)))
            M.restart_events()
        return M.DISABLE
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def restarts(code, source, destination):')


try: M.restart_events()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.restart_events()')
try: M.register_callback(1, E.BRANCH_RIGHT, restarts)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.register_callback(1, E.BRANCH_RIGHT, restarts)')
try: log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
try: if_else(7)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if_else(7)')
try: print(' '.join(log))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ' '.join(log)")
try: print('local events')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'local events'")
try: M.set_events(1, 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, 0)')
try: M.restart_events()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.restart_events()')
try: M.register_callback(1, E.BRANCH_RIGHT, told('R'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.register_callback(1, E.BRANCH_RIGHT, told('R'))")
try: M.set_local_events(1, if_else.__code__, E.BRANCH_LEFT)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_local_events(1, if_else.__code__, E.BRANCH_LEFT)')
try: log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
try: if_else(5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if_else(5)')
try: M.set_local_events(1, if_else.__code__, E.BRANCH_LEFT | E.BRANCH_RIGHT)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_local_events(1, if_else.__code__, E.BRANCH_LEFT | E.BRANCH_RIGHT)')
try: if_else(5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if_else(5)')
try: M.set_local_events(1, if_else.__code__, E.BRANCH_RIGHT)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_local_events(1, if_else.__code__, E.BRANCH_RIGHT)')
try: if_else(5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if_else(5)')
try: M.set_local_events(1, if_else.__code__, 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_local_events(1, if_else.__code__, 0)')
try: if_else(5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if_else(5)')
try: print(' '.join(log))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ' '.join(log)")
try: print('switched on and off while the loop runs')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'switched on and off while the loop runs'")


try:
    def switches(code, source, destination):
        if code is while_loop.__code__:
            log.append('L' + str(line_of(code, source)) + '>' + str(line_of(code, destination)))
            M.set_events(1, E.BRANCH_RIGHT if len(log) == 2 else E.BRANCH_LEFT | E.BRANCH_RIGHT)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def switches(code, source, destination):')


try:
    def right(code, source, destination):
        if code is while_loop.__code__:
            log.append('R' + str(line_of(code, source)) + '>' + str(line_of(code, destination)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def right(code, source, destination):')


try: M.register_callback(1, E.BRANCH_LEFT, switches)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.register_callback(1, E.BRANCH_LEFT, switches)')
try: M.register_callback(1, E.BRANCH_RIGHT, right)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.register_callback(1, E.BRANCH_RIGHT, right)')
try: log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
try: M.set_events(1, E.BRANCH_LEFT)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, E.BRANCH_LEFT)')
try: while_loop(4)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while_loop(4)')
try: M.set_events(1, 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, 0)')
try: print(' '.join(log))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ' '.join(log)")
try: print('a callback that raises')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'a callback that raises'")


try:
    def raises(code, source, destination):
        if code is handlers.__code__ and line_of(code, source) == 4:
            raise KeyError('from the tool')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raises(code, source, destination):')


try:
    for event in BOTH:
        try: M.register_callback(1, E.BRANCH_LEFT, None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.register_callback(1, E.BRANCH_LEFT, None)')
        try: M.register_callback(1, E.BRANCH_RIGHT, None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.register_callback(1, E.BRANCH_RIGHT, None)')
        try: M.register_callback(1, event, raises)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.register_callback(1, event, raises)')
        try: M.set_events(1, event)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, event)')
        try:
            result = handlers(3)
        except KeyError as e:
            result = 'raised', e.args, e.__traceback__.tb_next.tb_lineno - handlers.__code__.co_firstlineno
        try: M.set_events(1, 0)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, 0)')
        try: print('result [' + 'event=' + (repr(event) if type(event) in (str, int, float, bytes, bool, type(None)) or (type(event) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in event)) else event.__name__ if type(event) is type else type(event).__name__) + '] =>', result)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: result')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for event in BOTH:')
try: print('what the frame says meanwhile')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'what the frame says meanwhile'")


try:
    def looks(code, source, destination):
        if code is if_else.__code__:
            frame = sys._getframe(1)
            log.append((frame.f_lineno - code.co_firstlineno, frame.f_locals.get('i'), frame.f_locals.get('t')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def looks(code, source, destination):')


try: log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
try: M.register_callback(1, E.BRANCH_LEFT, looks)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.register_callback(1, E.BRANCH_LEFT, looks)')
try: M.register_callback(1, E.BRANCH_RIGHT, looks)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.register_callback(1, E.BRANCH_RIGHT, looks)')
try: M.set_events(1, E.BRANCH_LEFT | E.BRANCH_RIGHT)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, E.BRANCH_LEFT | E.BRANCH_RIGHT)')
try: if_else(4)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if_else(4)')
try: M.set_events(1, 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, 0)')
try: print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: M.free_tool_id(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.free_tool_id(1)')

try: print('== the event of old')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '== the event of old'")
try: M.use_tool_id(1, 'test')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.use_tool_id(1, 'test')")
try: log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')
try:
    with __import__('warnings').catch_warnings():
        __import__('warnings').simplefilter('ignore')
        BRANCH = E.BRANCH
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: with __import__('warnings').catch_warnings():")


try:
    def old(code, source, destination):
        if code is if_else.__code__:
            log.append(str(line_of(code, source)) + '>' + str(line_of(code, destination)))
            return M.DISABLE
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def old(code, source, destination):')


try: M.register_callback(1, BRANCH, old)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.register_callback(1, BRANCH, old)')
try: M.set_events(1, BRANCH)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, BRANCH)')
try: if_else(5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if_else(5)')
try: M.set_events(1, 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, 0)')
try: M.free_tool_id(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.free_tool_id(1)')
try: print(' '.join(log))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ' '.join(log)")

try: print('== with a trace function that sends the frame elsewhere')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '== with a trace function that sends the frame elsewhere'")


try:
    def jumper(n):
        t = 0
        for i in range(n):
            if i == 1:
                t += 100
            t += 1
        return t
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def jumper(n):')


try:
    def trace(frame, event, argument):
        if frame.f_code is jumper.__code__ and event == 'line' and frame.f_lineno == jumper.__code__.co_firstlineno + 3 and frame.f_locals['i'] == 0:
            frame.f_lineno = jumper.__code__.co_firstlineno + 4
        return trace
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def trace(frame, event, argument):')


try: M.use_tool_id(1, 'test')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.use_tool_id(1, 'test')")
try: log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log.clear()')


try:
    def seen(name):
        def callback(code, source, destination):
            if code is jumper.__code__:
                log.append(name + str(line_of(code, source)) + '>' + str(line_of(code, destination)))
        return callback
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def seen(name):')


try: M.register_callback(1, E.BRANCH_LEFT, seen('L'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.register_callback(1, E.BRANCH_LEFT, seen('L'))")
try: M.register_callback(1, E.BRANCH_RIGHT, seen('R'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.register_callback(1, E.BRANCH_RIGHT, seen('R'))")
try: M.set_events(1, E.BRANCH_LEFT | E.BRANCH_RIGHT)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, E.BRANCH_LEFT | E.BRANCH_RIGHT)')
try: sys.settrace(trace)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(trace)')
try: print(jumper(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: jumper(3)')
try: sys.settrace(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(None)')
try: M.set_events(1, 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.set_events(1, 0)')
try: M.free_tool_id(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M.free_tool_id(1)')
try: print(' '.join(log))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ' '.join(log)")
