# Places in a loop that are several things at once: where a branch arrives and a jump that leads where another branch arrives, a jump that a jump leads to, the
# end of the loop and the end of a statement in it. What a tool is told there must not depend on which other events it listens to, nor on what it has disabled.
#   loops x what comes after them x bodies of `if`, `else`, `break` and `continue` x events listened to x what the tool disables
# A digest for each group of rows; all rows with ROWS=1 in the environment.
try: import os
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import os')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: import textwrap
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import textwrap')
try: import zlib
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import zlib')

try: M = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M = sys.monitoring')
try: EVENTS = M.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: EVENTS = M.events')


try:
    def indented(source):
        return textwrap.indent(source, '    ')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def indented(source):')


try: PARTS = [
    't += 1',
    'break',
    'continue',
    'if b:\n    t += 1\nelse:\n    continue',
    'if b:\n    t += 1\nelse:\n    break',
    'if b:\n    continue',
    'if b:\n    break',
    'if b:\n    t += 1',
]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: PARTS = [ 't += 1', 'break', 'continue', 'if b:\\n t += 1\\nelse:\\n con...")
try: BODIES = ['if a:\n%s\n%s' % (indented(p), r) for p in PARTS for r in PARTS]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: BODIES = ['if a:\\n%s\\n%s' % (indented(p), r) for p in PARTS for r in ...")
try: BODIES += ['if a:\n%s\nelse:\n%s\n%s' % (indented(p), indented(q), r) for p in PARTS for q in PARTS for r in PARTS[:2]]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: BODIES += ['if a:\\n%s\\nelse:\\n%s\\n%s' % (indented(p), indented(q), r)...")
try: LOOPS = {
    'for': 'for a, b in xs:\n%s',
    'while': 'while i < len(xs):\n    a, b = xs[i]\n    i += 1\n%s',
    'for else': 'for a, b in xs:\n%s\nelse:\n    t += 10',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: LOOPS = { 'for': 'for a, b in xs:\\n%s', 'while': 'while i < len(xs):\\...")
try: AFTER = {'more': 't += 100\nt += 200\nt += 300\nreturn t', 'end': ''}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: AFTER = {'more': 't += 100\\nt += 200\\nt += 300\\nreturn t', 'end': ''}")
try: INPUTS = [[(0, 0), (1, 1)], [(1, 1), (0, 1)], [(1, 0), (0, 0)], [(0, 1), (1, 0)]]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: INPUTS = [[(0, 0), (1, 1)], [(1, 1), (0, 1)], [(1, 0), (0, 0)], [(0, ...')
try: LEFT, RIGHT, JUMP, LINE = EVENTS.BRANCH_LEFT, EVENTS.BRANCH_RIGHT, EVENTS.JUMP, EVENTS.LINE
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LEFT, RIGHT, JUMP, LINE = EVENTS.BRANCH_LEFT, EVENTS.BRANCH_RIGHT, EV...')
try: LISTENED_TO = {'LR': LEFT | RIGHT, 'LR and lines': LEFT | RIGHT | LINE, 'R': RIGHT, 'L': LEFT, 'LRJ': LEFT | RIGHT | JUMP}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: LISTENED_TO = {'LR': LEFT | RIGHT, 'LR and lines': LEFT | RIGHT | LIN...")
try: DISABLED = {
    'nothing': lambda count, kind: False,
    'everything': lambda count, kind: True,
    'left': lambda count, kind: kind == 'L',
    'right': lambda count, kind: kind == 'R',
    'every other': lambda count, kind: count % 2 == 0,
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: DISABLED = { 'nothing': lambda count, kind: False, 'everything': lamb...")
try: WAYS = [('LR and lines', 'nothing'), ('R', 'nothing'), ('L', 'nothing'), ('LRJ', 'nothing'), ('LR', 'everything'), ('LRJ', 'everything')]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: WAYS = [('LR and lines', 'nothing'), ('R', 'nothing'), ('L', 'nothing...")
try: WAYS += [('LR', 'left'), ('LR', 'right'), ('LRJ', 'every other')]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: WAYS += [('LR', 'left'), ('LR', 'right'), ('LRJ', 'every other')]")
# Not as in CPython yet: a branch to the end of a `while` loop that is the end of the function, behind `continue` and in front of `break`.
try: LEFT_OUT = {('while', 'end'): range(145, 176, 2)}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: LEFT_OUT = {('while', 'end'): range(145, 176, 2)}")


try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try: lines = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lines = {}')
try: disables = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: disables = None')


try:
    def two(kind):
        def told(code, a, b):
            log.append('%s%s>%s' % (kind, lines[a], lines[b]))
            if disables(len(log), kind):
                return M.DISABLE
        return told
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def two(kind):')


try:
    def main():
        global disables
        M.use_tool_id(1, 't')
        M.register_callback(1, LEFT, two('L'))
        M.register_callback(1, RIGHT, two('R'))
        M.register_callback(1, JUMP, two('J'))
        M.register_callback(1, LINE, lambda code, line: log.append(str(line - code.co_firstlineno + 1)))
        for loop_name, loop in LOOPS.items():
            for after_name, after in AFTER.items():
                if (loop_name, after_name) == ('for else', 'end'):
                    continue
                rows = {way: [] for way in WAYS}
                namespace = {}
                exec(''.join('def f%d(xs):\n    t = 0\n    i = 0\n%s\n%s\n' % (number, indented(loop % indented(body)), indented(after))
                             for number, body in enumerate(BODIES)), namespace)
                for number in range(len(BODIES)):
                    if number in LEFT_OUT.get((loop_name, after_name), ()):
                        continue
                    f = namespace['f%d' % number]
                    lines.clear()
                    for start, end, line in f.__code__.co_lines():
                        lines.update(dict.fromkeys(range(start, end), line and line - f.__code__.co_firstlineno + 1))
                    for way in WAYS:
                        disables = DISABLED[way[1]]
                        log.clear()
                        M.set_local_events(1, f.__code__, LISTENED_TO[way[0]])
                        for xs in INPUTS:
                            f(xs)
                            log.append('|')
                        M.set_local_events(1, f.__code__, 0)
                        M.restart_events()
                        rows[way].append('%d: %s' % (number, ' '.join(log)))
                for way in WAYS:
                    title = '%s, %s | %s, disables %s' % (loop_name, after_name, *way)
                    if os.environ.get('ROWS'):
                        print(title, *rows[way], sep='\n    ')
                    else:
                        print(title, '|', '%d rows %08x' % (len(rows[way]), zlib.crc32('\n'.join(rows[way]).encode())))
        M.free_tool_id(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def main():')


try: main()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: main()')
