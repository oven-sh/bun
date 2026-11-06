# Jumps to the end of a statement: over an `else`, over handlers, out of a handler, a `finally` clause, a `case` or a `with`, `break`. Whether a tool is told of
# one, of which line it is and where it and the branches around it are said to lead depends on what CPython's compiler makes of it: it lays what only an
# exception leads to behind everything else, drops a jump to what comes next, replaces a jump to a short end of the function by a copy of that, and is left
# with something that does nothing where only one way leads.
#   statements with such jumps x what comes after them x what they are in, the rest of the function in there too or behind it
# Here: statements in statements, and generators.
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
    'if else pass': '@if a:\n@    x = 1\n@else:\n@    pass\n',
    'if pass else': '@if a:\n@    pass\n@else:\n@    x = 1\n',
    'try in try': '@try:\n@    try:\n@        x = 1 // a\n@    except KeyError:\n@        x = 2\n@except ZeroDivisionError:\n@    x = 3\n',
    'try in try, both': '@try:\n@    try:\n@        x = 1 // a\n@    except ZeroDivisionError:\n@        x = 1 // b\n@except ZeroDivisionError:\n@    x = 3\n',
    'try in handler': '@try:\n@    x = 1 // a\n@except ZeroDivisionError:\n@    try:\n@        x = 1 // b\n@    except ZeroDivisionError:\n@        x = 3\n',
    'try in handler as': '@try:\n@    x = 1 // a\n@except ZeroDivisionError as e:\n@    try:\n@        x = 1 // b\n@    except ZeroDivisionError as e2:\n@        x = 3\n',
    'try in else': '@try:\n@    x = 1 // a\n@except ZeroDivisionError:\n@    x = 2\n@else:\n@    try:\n@        x = 1 // b\n@    except ZeroDivisionError:\n@        x = 3\n',
    'try in finally': '@try:\n@    x = 1\n@finally:\n@    try:\n@        x = 1 // a\n@    except ZeroDivisionError:\n@        x = 3\n',
    'finally in handler': '@try:\n@    x = 1 // a\n@except ZeroDivisionError:\n@    try:\n@        x = 2\n@    finally:\n@        x = 3\n',
    'with': '@with CM():\n@    x = 1\n',
    'with in handler': '@try:\n@    x = 1 // a\n@except ZeroDivisionError:\n@    with CM():\n@        x = 2\n',
    'with suppresses': '@with SUP():\n@    x = 1 // a\n',
    'with suppresses in handler': '@try:\n@    x = 1 // a\n@except ZeroDivisionError:\n@    with SUP():\n@        x = 1 // b\n',
    'with in if else': '@if a:\n@    with CM():\n@        x = 1\n@else:\n@    x = 2\n',
    'try in if else': '@if b:\n@    try:\n@        x = 1 // a\n@    except ZeroDivisionError:\n@        x = 2\n@else:\n@    x = 3\n',
    'try raises in if else': '@if b:\n@    try:\n@        raise E\n@    except E:\n@        x = 2\n@else:\n@    x = 3\n',
    'try raises in both': '@if b:\n@    try:\n@        raise E\n@    except E:\n@        x = 2\n@else:\n@    try:\n@        raise E\n@    except E:\n@        x = 3\n',
    'match in handler': '@try:\n@    raise E\n@except E:\n@    match a:\n@        case 1:\n@            x = 1\n@        case 0:\n@            x = 2\n',
    'match in handler 2': '@try:\n@    x = 1 // b\n@except ZeroDivisionError:\n@    match a:\n@        case 1:\n@            x = 1\n@        case 0:\n@            x = 2\n',
    'try in case': '@match a:\n@    case 1:\n@        try:\n@            x = 1 // b\n@        except ZeroDivisionError:\n@            x = 1\n@    case 0:\n@        x = 2\n',
    'handler returns': '@try:\n@    x = 1 // a\n@except ZeroDivisionError:\n@    return 5\n',
    'handler raises': '@try:\n@    x = 1 // a\n@except ZeroDivisionError:\n@    raise KeyError\n',
    'body returns': '@try:\n@    if a:\n@        return 5\n@    raise E\n@except E:\n@    x = 2\n',
    'while in handler': '@try:\n@    raise E\n@except E:\n@    n = 2\n@    while n:\n@        n -= 1\n@        if a:\n@            break\n',
    'for in handler': '@try:\n@    raise E\n@except E:\n@    for i in (1, 2):\n@        if a:\n@            break\n',
    'yield in handler': '@try:\n@    raise E\n@except E:\n@    yield 1\n@    if a:\n@        x = 2\n',
    'yield in handler 2': '@try:\n@    x = 1 // a\n@except ZeroDivisionError:\n@    yield 1\n@    try:\n@        x = 1 // b\n@    except ZeroDivisionError:\n@        yield 2\n',
    'yield in finally': '@try:\n@    x = 1 // a\n@finally:\n@    yield 1\n@    if b:\n@        x = 2\n',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: HEADS = { 'if else pass': '@if a:\\n@ x = 1\\n@else:\\n@ pass\\n', 'if pa...")
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
# Not as in CPython yet: where the last pattern of a `match` fails at the end of the body of a loop; where a jump leads that stays in front of the end of a handler.
try: LEFT_OUT = {
    ('in for', 'in'): ('match', 'match if', 'try in case'),
    ('in while', 'in'): ('match', 'match if', 'try in case'),
    ('in handler', 'behind'): ('try raises, if else', 'finally if else', 'finally in handler', 'try raises in both', 'try in case', 'while in handler', 'for in handler'),
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: LEFT_OUT = { ('in for', 'in'): ('match', 'match if', 'try in case'), ...")


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
                    if head_name in LEFT_OUT.get((wrap, where), ()):
                        continue
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
