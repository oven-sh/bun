# frame.f_lineno = n where the value of a `return` has several ways through it (a conditional expression, `or`, a comprehension), and the `finally` clause on the way never hands it on: from the
# line of the `return` when the frame is told of it again, with the value, and from the lines of the clause; to that line and to the clauses. By a trace function and by a tool. A collection comes
# at every event, at every instruction and jump, and in every helper: it must not tell.
try: import sys, warnings, gc, re
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, warnings, gc, re')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")
try:
    def collect(): gc.collect(0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def collect(): gc.collect(0)')
try:
    class E(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(Exception): pass')
try:
    class V:
        def __repr__(self): return 'V()'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class V:')
try:
    class M:
        def __enter__(self): return self
        def __exit__(self, *a): collect(); return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M:')
try:
    def c(v): collect(); return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c(v): collect(); return v')
try: VALUES = {'conditional': 'V() if c(t) else c(V())', 'or': 'c(t) or V()', 'over lines': '(V() if c(t) else\n    c(V()))', 'comprehension': '[V() for i in (1, 2) if c(t)]', 'walrus': '(w := V() if c(t) else c(V()))', 'call': 'V()'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: VALUES = {'conditional': 'V() if c(t) else c(V())', 'or': 'c(t) or V(...")
try: ENDS = {'return': 'return 5'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ENDS = {'return': 'return 5'}")
try: AROUND = {'plain': 'return X', 'with': 'with M():\n    return X'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: AROUND = {'plain': 'return X', 'with': 'with M():\\n return X'}")
try:
    def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def indent(t, n=4): return '\\n'.join(' ' * n + l for l in t.split('\\n'))")
try:
    def program(value, around, end):
        first = 'try:\n' + indent(around.replace('X', value.replace('\n', '\n' + ' ' * (around.count('\n') * 4)))) + '\nfinally:\n    x = 1\n' + indent(end)
        return 'if s:\n' + indent(first) + '\ntry:\n    return V()\nfinally:\n    y = 2'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def program(value, around, end):')
try: mon = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mon = sys.monitoring')
try:
    def run(f, code, how, index, target, t):
        ev = []; count = [0]
        def at(frame, what):
            collect()
            ev.append(what)
            if count[0] == index:
                try: frame.f_lineno = target
                except ValueError as e: ev.append('(%s)' % e)
                else: ev.append('>%d' % target)
                collect()
            count[0] += 1
            if len(ev) > 60: raise E('too long')
        def tr(frame, event, arg):
            if frame.f_code is not code: return None
            frame.f_trace_opcodes = True
            if event == 'opcode': collect()
            if event == 'line': at(frame, str(frame.f_lineno))
            return tr
        def line(co, number):
            if co is code: at(sys._getframe(1), str(number))
        def other(co, *a): collect()
        events = {mon.events.LINE: line, mon.events.JUMP: other, mon.events.INSTRUCTION: other}
        if how == 'trace': sys.settrace(tr)
        else:
            mon.use_tool_id(3, 't'); mon.set_local_events(3, code, sum(events))
            for e, callback in events.items(): mon.register_callback(3, e, callback)
        try: r = repr(f(1, t))
        except BaseException as e: r = '%s: %s' % (type(e).__name__, e)
        finally:
            if how == 'trace': sys.settrace(None)
            else:
                mon.set_local_events(3, code, 0); mon.free_tool_id(3)
        return ' '.join(ev) + ' => ' + re.sub(' at 0x[0-9a-f]+', '', r), ev
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(f, code, how, index, target, t):')
try:
    def main():
        for vn, value in VALUES.items():
            for an, around in AROUND.items():
                for en, end in ENDS.items():
                    body = program(value, around, end); lines = body.split('\n')
                    ns = {'E': E, 'M': M, 'c': c, 'V': V}
                    exec(compile('def f(s, t):\n' + indent(body) + '\n', 'p', 'exec'), ns)
                    f = ns['f']
                    first = next(i + 2 for i, l in enumerate(lines) if l.strip().startswith('return'))
                    clause = [i + 2 for i, l in enumerate(lines) if l.strip() in ('x = 1', end)]
                    for how in ('trace', 'tool'):
                        for t in (0, 1) if vn == 'conditional' else (1,):
                            told = run(f, f.__code__, how, -1, 0, t)[1]
                            # (The lines of a comprehension are told of again while it runs.)
                            sources = [i for i, l in enumerate(told) if int(l) in clause or (int(l) == first and str(first) in told[:i] and vn != 'comprehension')]
                            for index in sources:
                                for target in (first, len(lines) + 1):
                                    print('%s, %s, %s | %s %d | %d to %d | %s' % (vn, an, en, how, t, index, target, run(f, f.__code__, how, index, target, t)[0]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def main():')
try: main()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: main()')
