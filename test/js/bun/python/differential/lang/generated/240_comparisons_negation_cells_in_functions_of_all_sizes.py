# Comparisons with and without a jump behind them, unary operators, floor division and stores to cells, in functions with a few
# variables, with hundreds and with tens of thousands, over short and longer distances; run plainly, traced by line and by
# instruction, monitored, and after a round trip through marshal. (slow/ has the same with more values, sizes and distances.)
try: import sys, marshal, hashlib, types
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, marshal, hashlib, types')

try: VALUES = [(1, 2), (2, 1), (2, 2), (float('nan'), 1), (None, None)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: VALUES = [(1, 2), (2, 1), (2, 2), (float('nan'), 1), (None, None)]")


try:
    def source(variables, distance):
        # The variables that come first only take up room: nothing is ever assigned to them.
        lines = ['def f(p, q):', '    if p is ...:', '        ' + ' = '.join('v%d' % i for i in range(variables)) + ' = 0']
        lines += ['    a = p', '    b = q', '    out = []', '    add = out.append']
        lines += ['    c = 0', '    def get(): return c, d', '    d = 1']
        for operator in ('<', '<=', '==', '!=', '>', '>='):
            lines += ['    try:', '        r = a %s b' % operator, '        add(r)', '    except TypeError as e:', '        add(str(e))']
        filler = ['            c += 1'] * distance
        for operator in ('<', '<=', '==', '!=', '>', '>='):
            lines += ['    try:', '        if a %s b:' % operator] + filler + ['            add(%r)' % operator, '        else:'] + filler + ['            add("not " + %r)' % operator]
            lines += ['        if a %s b or c < 0:' % operator] + filler + ['            add(1)']
            lines += ['        if not (a %s b and c >= 0):' % operator] + filler + ['            add(2)']
            lines += ['        n = 0', '        while n %s 1 and n != 3:' % operator] + filler + ['            n += 1', '        add(n)']
            lines += ['        add("yes" if b %s a else "no")' % operator]
            lines += ['    except TypeError as e:', '        add(str(e))']
        for expression in ('-a', '+a', '~a', 'not a', 'a // b', 'b // a', '-(a // b)', 'not -a'):
            lines += ['    try:', '        r = %s' % expression, '        add(r)', '    except (TypeError, ZeroDivisionError) as e:', '        add(str(e))']
        lines += ['    c = a', '    d = b', '    add(get())', '    c = d = out', '    add(get()[0] is get()[1] is out)']
        lines += ['    c = None', '    return out + [%d]' % (variables - 1)]
        return '\n'.join(lines) + '\n'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def source(variables, distance):')


try:
    def digest(value):
        return hashlib.sha1(repr(value).encode()).hexdigest()[:10]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def digest(value):')


# (As text: a NaN is not equal to itself.)
try:
    def run(function):
        return [repr(function(p, q)[:-1]) for p, q in VALUES]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(function):')


try:
    def traced(function, by_instruction):
        events = []

        def trace(frame, event, argument):
            if frame.f_code.co_filename != '<sizes>':
                return None
            frame.f_trace_opcodes = by_instruction
            if event != 'opcode':
                events.append((event, frame.f_lineno))
            return trace

        sys.settrace(trace)
        try:
            result = run(function)
        finally:
            sys.settrace(None)
        return result, events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def traced(function, by_instruction):')


try:
    def monitored(function):
        E = sys.monitoring.events
        seen = []
        code = function.__code__
        lines = {}
        for start, end, line in code.co_lines():
            lines[start] = line
        starts = sorted(lines)

        def line_of(offset):
            low, high = 0, len(starts)
            while high - low > 1:
                middle = (low + high) // 2
                if starts[middle] <= offset:
                    low = middle
                else:
                    high = middle
            return lines[starts[low]]

        sys.monitoring.use_tool_id(4, 'sizes')
        for event, label in ((E.BRANCH_LEFT, 'left'), (E.BRANCH_RIGHT, 'right')):
            sys.monitoring.register_callback(4, event, lambda code, origin, destination, label=label: seen.append((label, line_of(origin), line_of(destination))))
        sys.monitoring.set_local_events(4, code, E.BRANCH_LEFT | E.BRANCH_RIGHT)
        try:
            result = run(function)
        finally:
            sys.monitoring.set_local_events(4, code, 0)
            sys.monitoring.free_tool_id(4)
        return result, seen
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def monitored(function):')


try: first = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first = None')
try:
    for variables, distance in ((1, 1), (300, 40), (33000, 1)):
        try: code = compile(source(variables, distance), '<sizes>', 'exec')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: code = compile(source(variables, distance), '<sizes>', 'exec')")
        try: namespace = {}
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: namespace = {}')
        try: exec(code, namespace)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exec(code, namespace)')
        try: f = namespace['f']
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: f = namespace['f']")
        try: plain = run(f)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: plain = run(f)')
        if first is None:
            try: first = plain
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first = plain')
            for values, result in zip(VALUES, plain):
                try: print('values [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'distance=' + (repr(distance) if type(distance) in (str, int, float, bytes, bool, type(None)) or (type(distance) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in distance)) else distance.__name__ if type(distance) is type else type(distance).__name__) + ", " + 'values=' + (repr(values) if type(values) in (str, int, float, bytes, bool, type(None)) or (type(values) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in values)) else values.__name__ if type(values) is type else type(values).__name__) + ", " + 'result=' + (repr(result) if type(result) in (str, int, float, bytes, bool, type(None)) or (type(result) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in result)) else result.__name__ if type(result) is type else type(result).__name__) + '] =>', values)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: values')
                try: print('result [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'distance=' + (repr(distance) if type(distance) in (str, int, float, bytes, bool, type(None)) or (type(distance) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in distance)) else distance.__name__ if type(distance) is type else type(distance).__name__) + ", " + 'values=' + (repr(values) if type(values) in (str, int, float, bytes, bool, type(None)) or (type(values) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in values)) else values.__name__ if type(values) is type else type(values).__name__) + ", " + 'result=' + (repr(result) if type(result) in (str, int, float, bytes, bool, type(None)) or (type(result) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in result)) else result.__name__ if type(result) is type else type(result).__name__) + '] =>', result)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: result')
        try: print('variables [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'distance=' + (repr(distance) if type(distance) in (str, int, float, bytes, bool, type(None)) or (type(distance) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in distance)) else distance.__name__ if type(distance) is type else type(distance).__name__) + '] =>', variables)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: variables')
        try: print('distance [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'distance=' + (repr(distance) if type(distance) in (str, int, float, bytes, bool, type(None)) or (type(distance) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in distance)) else distance.__name__ if type(distance) is type else type(distance).__name__) + '] =>', distance)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: distance')
        try: print('as in the smallest:', 'plain == first [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'distance=' + (repr(distance) if type(distance) in (str, int, float, bytes, bool, type(None)) or (type(distance) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in distance)) else distance.__name__ if type(distance) is type else type(distance).__name__) + '] =>', plain == first)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: plain == first')
        try: print('f(1, 2)[-1] [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'distance=' + (repr(distance) if type(distance) in (str, int, float, bytes, bool, type(None)) or (type(distance) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in distance)) else distance.__name__ if type(distance) is type else type(distance).__name__) + '] =>', f(1, 2)[-1])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f(1, 2)[-1]')
        try: small = variables < 1000
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: small = variables < 1000')
        try: by_line = traced(f, False)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: by_line = traced(f, False)')
        try: print('    by line:', 'by_line[0] == plain [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'distance=' + (repr(distance) if type(distance) in (str, int, float, bytes, bool, type(None)) or (type(distance) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in distance)) else distance.__name__ if type(distance) is type else type(distance).__name__) + '] =>', by_line[0] == plain)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: by_line[0] == plain')
        try: print('len(by_line[1]) [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'distance=' + (repr(distance) if type(distance) in (str, int, float, bytes, bool, type(None)) or (type(distance) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in distance)) else distance.__name__ if type(distance) is type else type(distance).__name__) + '] =>', len(by_line[1]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(by_line[1])')
        try: print('digest(by_line[1]) [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'distance=' + (repr(distance) if type(distance) in (str, int, float, bytes, bool, type(None)) or (type(distance) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in distance)) else distance.__name__ if type(distance) is type else type(distance).__name__) + '] =>', digest(by_line[1]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: digest(by_line[1])')
        if small:
            try: by_instruction = traced(f, True)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: by_instruction = traced(f, True)')
            try: print('    by instruction:', 'by_instruction[0] == plain [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'distance=' + (repr(distance) if type(distance) in (str, int, float, bytes, bool, type(None)) or (type(distance) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in distance)) else distance.__name__ if type(distance) is type else type(distance).__name__) + '] =>', by_instruction[0] == plain)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: by_instruction[0] == plain')
            try: print('by_instruction[1] == by_line[1] [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'distance=' + (repr(distance) if type(distance) in (str, int, float, bytes, bool, type(None)) or (type(distance) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in distance)) else distance.__name__ if type(distance) is type else type(distance).__name__) + '] =>', by_instruction[1] == by_line[1])
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: by_instruction[1] == by_line[1]')
        try: branches = monitored(f)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: branches = monitored(f)')
        try: print('    monitored:', 'branches[0] == plain [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'distance=' + (repr(distance) if type(distance) in (str, int, float, bytes, bool, type(None)) or (type(distance) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in distance)) else distance.__name__ if type(distance) is type else type(distance).__name__) + '] =>', branches[0] == plain)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: branches[0] == plain')
        try: print('len(branches[1]) [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'distance=' + (repr(distance) if type(distance) in (str, int, float, bytes, bool, type(None)) or (type(distance) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in distance)) else distance.__name__ if type(distance) is type else type(distance).__name__) + '] =>', len(branches[1]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(branches[1])')
        try: print('digest(branches[1]) [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'distance=' + (repr(distance) if type(distance) in (str, int, float, bytes, bool, type(None)) or (type(distance) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in distance)) else distance.__name__ if type(distance) is type else type(distance).__name__) + '] =>', digest(branches[1]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: digest(branches[1])')
        try: print('    afterwards:', 'run(f) == plain [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'distance=' + (repr(distance) if type(distance) in (str, int, float, bytes, bool, type(None)) or (type(distance) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in distance)) else distance.__name__ if type(distance) is type else type(distance).__name__) + '] =>', run(f) == plain)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(f) == plain')
        try: namespace = {}
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: namespace = {}')
        try: exec(marshal.loads(marshal.dumps(code)), namespace)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exec(marshal.loads(marshal.dumps(code)), namespace)')
        try: print('    after marshal:', "run(namespace['f']) == plain [" + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'distance=' + (repr(distance) if type(distance) in (str, int, float, bytes, bool, type(None)) or (type(distance) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in distance)) else distance.__name__ if type(distance) is type else type(distance).__name__) + '] =>', run(namespace['f']) == plain)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: run(namespace['f']) == plain")
        # While it is traced, too.
        try: sys.settrace(lambda *a: None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(lambda *a: None)')
        try: copy = marshal.loads(marshal.dumps(f.__code__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: copy = marshal.loads(marshal.dumps(f.__code__))')
        try: sys.settrace(None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(None)')
        try: print('    a copy made while tracing:', 'run(types.FunctionType(copy, {})) == plain if not copy.co_freevars el... [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'distance=' + (repr(distance) if type(distance) in (str, int, float, bytes, bool, type(None)) or (type(distance) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in distance)) else distance.__name__ if type(distance) is type else type(distance).__name__) + '] =>', run(types.FunctionType(copy, {})) == plain if not copy.co_freevars else None)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(types.FunctionType(copy, {})) == plain if not copy.co_freevars el...')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for variables, distance in ((1, 1), (300, 40), (33000, 1)):')
