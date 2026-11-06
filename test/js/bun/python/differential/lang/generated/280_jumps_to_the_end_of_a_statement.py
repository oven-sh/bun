# Jumps to the end of a statement: over an `else`, over handlers, out of a handler, a `finally` clause, a `case` or a `with`, `break`. Whether a tool is told of
# one, of which line it is and where it and the branches around it are said to lead depends on what CPython's compiler makes of it: it lays what only an
# exception leads to behind everything else, drops a jump to what comes next, replaces a jump to a short end of the function by a copy of that, and is left
# with something that does nothing where only one way leads.
#   statements with such jumps x what comes after them x what they are in, the rest of the function in there too or behind it
# A digest for each group of rows; all rows with ROWS=1 in the environment.
try: import os
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import os')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: import zlib
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import zlib')

try: M = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M = sys.monitoring')
try: EVENTS = M.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: EVENTS = M.events')


try:
    class E(Exception):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(Exception):')


try:
    class CM:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CM:')


try:
    class SUP:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SUP:')


# @ is the indentation.
try: HEADS = {
    'if else': '@if a:\n@    x = 1\n@else:\n@    x = 2\n',
    'elif': '@if a:\n@    x = 1\n@elif b:\n@    x = 2\n@else:\n@    x = 3\n',
    'elif, no else': '@if a:\n@    x = 1\n@elif b:\n@    x = 2\n',
    'if in if else': '@if a:\n@    if b:\n@        x = 1\n@else:\n@    x = 2\n',
    'if else in if': '@if a:\n@    if b:\n@        x = 1\n@    else:\n@        x = 2\n',
    'if else in else': '@if a:\n@    x = 0\n@else:\n@    if b:\n@        x = 1\n@    else:\n@        x = 2\n',
    'try': '@try:\n@    x = 1 // a\n@except ZeroDivisionError:\n@    x = 2\n',
    'try as': '@try:\n@    x = 1 // a\n@except ZeroDivisionError as e:\n@    x = 2\n',
    'try raises': '@try:\n@    raise E\n@except E:\n@    x = 2\n',
    'try raises as': '@try:\n@    raise E\n@except E as e:\n@    x = 2\n',
    'try raises, if': '@try:\n@    raise E\n@except E:\n@    if a:\n@        x = 2\n',
    'try raises as, if': '@try:\n@    raise E\n@except E as e:\n@    if a:\n@        x = 2\n',
    'try raises, if else': '@try:\n@    raise E\n@except E:\n@    if a:\n@        x = 2\n@    else:\n@        x = 3\n',
    'two handlers': '@try:\n@    raise (E if a else KeyError)\n@except KeyError:\n@    x = 1\n@except E:\n@    if b:\n@        x = 2\n',
    'try else': '@try:\n@    x = 1 // a\n@except ZeroDivisionError:\n@    x = 2\n@else:\n@    x = 3\n',
    'try else if': '@try:\n@    x = 1 // a\n@except ZeroDivisionError:\n@    x = 2\n@else:\n@    if b:\n@        x = 3\n',
    'finally': '@try:\n@    x = 1\n@finally:\n@    if a:\n@        x = 2\n',
    'finally if else': '@try:\n@    x = 1\n@finally:\n@    if a:\n@        x = 2\n@    else:\n@        x = 3\n',
    'try except finally': '@try:\n@    x = 1 // a\n@except ZeroDivisionError:\n@    x = 2\n@finally:\n@    y = 3\n',
    'finally, raising': '@try:\n@    try:\n@        raise E\n@    finally:\n@        if a:\n@            x = 2\n@except E:\n@    x = 3\n',
    'match': '@match a:\n@    case 1:\n@        x = 1\n@    case 0:\n@        x = 2\n',
    'match default': '@match a:\n@    case 1:\n@        x = 1\n@    case _:\n@        x = 2\n',
    'match if': '@match a:\n@    case 1:\n@        if b:\n@            x = 1\n@    case 0:\n@        x = 2\n',
    'for break else': '@for i in (1, 2):\n@    if a:\n@        break\n@else:\n@    x = 2\n',
    'for break more': '@for i in (1, 2):\n@    if a:\n@        break\n@    x = i\n',
    'while break': '@n = 2\n@while n:\n@    n -= 1\n@    if a:\n@        break\n',
    'while break else': '@n = 2\n@while n:\n@    n -= 1\n@    if a:\n@        break\n@else:\n@    x = 2\n',
    'while true': '@while True:\n@    if a:\n@        break\n@    a = 1\n',
    'break in try': '@for i in (1, 2):\n@    try:\n@        if a:\n@            break\n@    except E:\n@        pass\n',
    'break in handler': '@for i in (1, 2):\n@    try:\n@        raise E\n@    except E:\n@        if a:\n@            break\n',
    'break in with': '@for i in (1, 2):\n@    with CM():\n@        if a:\n@            break\n',
    'with if else': '@with CM():\n@    if a:\n@        x = 1\n@    else:\n@        x = 2\n',
    'except*': '@try:\n@    x = 1 // a\n@except* ZeroDivisionError:\n@    x = 2\n',
    'except* as': '@try:\n@    x = 1 // a\n@except* ZeroDivisionError as e:\n@    x = 2\n',
    'except* else': '@try:\n@    x = 1 // a\n@except* ZeroDivisionError:\n@    x = 2\n@else:\n@    x = 3\n',
    'except* raises, if': '@try:\n@    raise E\n@except* E:\n@    if a:\n@        x = 2\n',
    'except* twice': '@try:\n@    raise (E if a else KeyError)\n@except* KeyError:\n@    x = 1\n@except* E:\n@    if b:\n@        x = 2\n',
    'except* clause raises': '@try:\n@    try:\n@        raise E\n@    except* E:\n@        raise KeyError\n@    except* KeyError:\n@        x = 1\n@except* KeyError:\n@    x = 2\n',
    'except* not caught': '@try:\n@    try:\n@        raise E\n@    except* KeyError:\n@        x = 1\n@except E:\n@    x = 2\n',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: HEADS = { 'if else': '@if a:\\n@ x = 1\\n@else:\\n@ x = 2\\n', 'elif': '@...")
try: TAILS = {
    'nothing': '',
    'return const': '@return 1\n',
    'return sum3': '@return x + a + x\n',
    'raise': '@raise KeyError\n',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: TAILS = { 'nothing': '', 'return const': '@return 1\\n', 'return sum3'...")
try: WRAPS = {
    'function': ('', '@'),
    'in if': ('    if c:\n', '@    '),
    'in else': ('    if not c:\n        x = 9\n    else:\n', '@    '),
    'in try': ('    try:\n', '@    '),
    'in handler': ('    try:\n        raise E\n    except E:\n', '@    '),
    'in for': ('    for j in (1,):\n', '@    '),
    'in while': ('    while c:\n        c = 0\n', '@    '),
    'in with': ('    with CM():\n', '@    '),
    'in case': ('    match c:\n     case 1:\n', '@    '),
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: WRAPS = { 'function': ('', '@'), 'in if': (' if c:\\n', '@ '), 'in els...")
try: CLOSING = {'in try': '    except KeyError:\n        raise\n', 'in case': '     case 2:\n        x = 7\n'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: CLOSING = {'in try': ' except KeyError:\\n raise\\n', 'in case': ' case...")
try: WHERE = {'function': ('in',), 'in if': ('behind',), 'in try': ('in', 'behind'), 'in handler': ('in', 'behind')}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: WHERE = {'function': ('in',), 'in if': ('behind',), 'in try': ('in', ...")


try:
    def line_of(code, offset):
        for start, end, line in code.co_lines():
            if start <= offset < end:
                return line
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def line_of(code, offset):')


try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')


try:
    def two(name):
        def told(code, a, b):
            if code.co_filename == 'g':
                log.append('%s%s>%s' % (name, line_of(code, a), line_of(code, b)))
        return told
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def two(name):')


try:
    def rows_of(wrap, where, head):
        before, indent = WRAPS[wrap]
        indent = indent.replace('@', '    ')
        rows = []
        for tail_name, tail in TAILS.items():
            source = 'def f(a, b, c, k):\n    x = 0\n' + before + head.replace('@', indent)
            if where == 'in':
                source += tail.replace('@', indent) + CLOSING.get(wrap, '')
            else:
                source += CLOSING.get(wrap, '') + tail.replace('@', '    ')
            namespace = {'E': E, 'CM': CM, 'SUP': SUP}
            exec(compile(source, 'g', 'exec'), namespace)
            for a, b in ((0, 1), (1, 0)):
                log.clear()
                M.set_events(1, EVENTS.BRANCH_LEFT | EVENTS.BRANCH_RIGHT | EVENTS.JUMP | EVENTS.LINE)
                try:
                    result = namespace['f'](a, b, 1, KeyError)
                    if hasattr(result, 'send'):
                        list(result)
                except Exception as e:
                    log.append(type(e).__name__)
                M.set_events(1, 0)
                rows.append('%s %d%d: %s' % (tail_name, a, b, ' '.join(log)))
        return rows
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rows_of(wrap, where, head):')


try:
    def main():
        M.use_tool_id(1, 't')
        M.register_callback(1, EVENTS.BRANCH_LEFT, two('BL'))
        M.register_callback(1, EVENTS.BRANCH_RIGHT, two('BR'))
        M.register_callback(1, EVENTS.JUMP, two('J'))
        M.register_callback(1, EVENTS.LINE, lambda code, line: log.append('L%d' % line) if code.co_filename == 'g' else None)
        for wrap in WRAPS:
            for where in WHERE.get(wrap, ('in',)):
                for head_name, head in HEADS.items():
                    rows = rows_of(wrap, where, head)
                    title = '%s, the rest %s | %s' % (wrap, where, head_name)
                    if os.environ.get('ROWS'):
                        print(title, *rows, sep='\n    ')
                    else:
                        print(title, '|', '%d rows %08x' % (len(rows), zlib.crc32('\n'.join(rows).encode())))
        M.free_tool_id(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def main():')


try: main()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: main()')
