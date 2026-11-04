# Jumps over a little code and over a lot of it: whatever the distance, the same thing happens, the same lines are
# traced, and what is raised far away says where it was raised.
try: import sys, hashlib
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, hashlib')

try: SIZES = (1, 12, 30, 45, 130, 1000, 6000)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SIZES = (1, 12, 30, 45, 130, 1000, 6000)')


try:
    def filler(count, indent, name='n'):
        return ''.join('%s%s += 1\n' % (indent, name) for _ in range(count))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def filler(count, indent, name='n'):")


try: TEMPLATES = {
    'if else': '''
def f(a):
    n = 0
    if a:
{body8}    else:
        n -= 1
    return n
''',
    'if elif chain': '''
def f(a):
    n = 0
    if a == 0:
{body8}    elif a == 1:
{body8}        n *= 2
    elif a is None:
{body8}        n *= 3
    else:
        n = -1
    return n
''',
    'and or': '''
def f(a):
    n = 0
    if a and (a > 0 or a < -5) and not (a == 3):
{body8}    return n
''',
    'for break else': '''
def f(a):
    n = 0
    for i in range(3):
        if i == a:
            break
{body8}    else:
        n = -n
    return n
''',
    'while continue': '''
def f(a):
    n = i = 0
    while i < 3:
        i += 1
        if i == a:
            continue
{body8}    return n
''',
    'try except': '''
def f(a):
    n = 0
    try:
{body8}        if a:
            raise KeyError(a)
{body8}    except KeyError as e:
{body8}        n = -n
    else:
        n += 1000000
    finally:
{body8}    return n
''',
    'with': '''
class M:
    def __enter__(self): return 5
    def __exit__(self, *a): return a[0] is KeyError
def f(a):
    n = 0
    with M() as m:
{body8}        if a:
            raise KeyError(a)
{body8}    return n
''',
    'match': '''
def f(a):
    n = 0
    match a:
        case 0:
{body12}        case 1 | 2:
{body12}            n *= 2
        case None:
{body12}            n *= 3
        case _:
            n = -1
    return n
''',
    'generator': '''
def g(a):
    n = 0
    for i in range(2):
{body8}        got = yield n
        if got or a:
{body12}            n = -n
    return n
def h(a):
    n = yield from g(a)
{body4}    return n
def f(a):
    it = h(a)
    out = []
    try:
        out.append(next(it))
        out.append(it.send(a))
        out.append(next(it))
    except StopIteration as e:
        out.append(('returned', e.value))
    return out
''',
    'conditional expression': '''
def f(a):
    n = 0
    for i in range(2):
        n += (1 if a else 2) if i else (3 if a is None else 4)
{body8}    return n
''',
    'loop in loop': '''
def f(a):
    n = 0
    for i in range(2):
        for j in range(2):
            if j == a:
                continue
{body12}        if i == a:
            break
{body8}    return n
''',
    'raise far away': '''
def f(a):
    n = 0
    try:
        if a:
{body12}            n = 1 // 0
{body8}    finally:
        n += 1
    return n
''',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: TEMPLATES = { 'if else': ''' def f(a): n = 0 if a: {body8} else: n -=...")


try:
    def events(function, argument):
        seen = []

        def trace(frame, event, arg):
            if frame.f_code.co_filename == '<far>':
                seen.append((event, frame.f_lineno - frame.f_code.co_firstlineno))
                return trace

        sys.settrace(trace)
        try:
            try:
                result = function(argument)
            except Exception as e:
                tb = e.__traceback__
                while tb.tb_next:
                    tb = tb.tb_next
                result = (type(e).__name__, tb.tb_lineno, tb.tb_frame.f_code.co_name)
        finally:
            sys.settrace(None)
        return result, len(seen), hashlib.sha1(repr(seen).encode()).hexdigest()[:10]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def events(function, argument):')


try:
    for name, template in TEMPLATES.items():
        for size in SIZES:
            try: source = template.format(body4=filler(size, ' ' * 4), body8=filler(size, ' ' * 8), body12=filler(size, ' ' * 12))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: source = template.format(body4=filler(size, ' ' * 4), body8=filler(si...")
            try: namespace = {}
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: namespace = {}')
            try: exec(compile(source, '<far>', 'exec'), namespace)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec(compile(source, '<far>', 'exec'), namespace)")
            try: f = namespace['f']
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: f = namespace['f']")
            try: lines = sorted({line for _, _, line in f.__code__.co_lines() if line is not None})
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lines = sorted({line for _, _, line in f.__code__.co_lines() if line ...')
            try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'template=' + (repr(template) if type(template) in (str, int, float, bytes, bool, type(None)) or (type(template) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in template)) else template.__name__ if type(template) is type else type(template).__name__) + ", " + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', name)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
            try: print('size [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'template=' + (repr(template) if type(template) in (str, int, float, bytes, bool, type(None)) or (type(template) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in template)) else template.__name__ if type(template) is type else type(template).__name__) + ", " + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', size)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: size')
            try: print('[events(f, a) for a in (0, 1, 2, None)] [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'template=' + (repr(template) if type(template) in (str, int, float, bytes, bool, type(None)) or (type(template) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in template)) else template.__name__ if type(template) is type else type(template).__name__) + ", " + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', [events(f, a) for a in (0, 1, 2, None)])
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [events(f, a) for a in (0, 1, 2, None)]')
            try: print('len(lines) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'template=' + (repr(template) if type(template) in (str, int, float, bytes, bool, type(None)) or (type(template) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in template)) else template.__name__ if type(template) is type else type(template).__name__) + ", " + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', len(lines))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(lines)')
            try: print('lines[-1] [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'template=' + (repr(template) if type(template) in (str, int, float, bytes, bool, type(None)) or (type(template) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in template)) else template.__name__ if type(template) is type else type(template).__name__) + ", " + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', lines[-1])
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lines[-1]')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name, template in TEMPLATES.items():')

# At the level of a module, and in a class.
try:
    for size in SIZES:
        try: source = 'n = 0\nfor i in range(3):\n    if i == 1:\n        continue\n' + filler(size, '    ') + 'else:\n    n = -n\nclass C:\n    n = 0\n    while n < 5:\n' + filler(size, ' ' * 8) + '    if n:\n' + filler(size, ' ' * 8) + '    else:\n        n = None\n'
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: source = 'n = 0\\nfor i in range(3):\\n if i == 1:\\n continue\\n' + fill...")
        try: namespace = {}
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: namespace = {}')
        try: exec(compile(source, '<far>', 'exec'), namespace)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec(compile(source, '<far>', 'exec'), namespace)")
        try: print('module', 'size [' + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', size)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: size')
        try: print("namespace['n'] [" + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', namespace['n'])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: namespace['n']")
        try: print("namespace['C'].n [" + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', namespace['C'].n)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: namespace['C'].n")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for size in SIZES:')

# sys.monitoring tells of branches and jumps with the places they lead to.
try: E = sys.monitoring.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E = sys.monitoring.events')
try:
    for name, size in [(name, size) for name in ('while continue', 'if elif chain', 'loop in loop', 'and or') for size in (1, 45, 1000)]:
        # (CPython copies a short end of a function to wherever a jump would lead to it.)
        try: source = TEMPLATES[name].format(body8=filler(size, ' ' * 8), body12=filler(size, ' ' * 12)).replace('    return n\n', '    n += 0\n    n += 0\n    return n\n')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: source = TEMPLATES[name].format(body8=filler(size, ' ' * 8), body12=f...")
        try: namespace = {}
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: namespace = {}')
        try: exec(compile(source, '<far>', 'exec'), namespace)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec(compile(source, '<far>', 'exec'), namespace)")
        try: f = namespace['f']
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: f = namespace['f']")
        try: seen = []
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen = []')
        try: sys.monitoring.use_tool_id(3, 'far')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: sys.monitoring.use_tool_id(3, 'far')")
        for event, label in ((E.BRANCH_LEFT, 'left'), (E.BRANCH_RIGHT, 'right'), (E.JUMP, 'jump')):
            def callback(code, source, destination, label=label):
                where = {start: line for start, _, line in code.co_lines()}
                def line_of(offset):
                    return max((start, line) for start, line in where.items() if start <= offset)[1]
                seen.append((label, line_of(source), line_of(destination)))
            try: sys.monitoring.register_callback(3, event, callback)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.monitoring.register_callback(3, event, callback)')
        try: sys.monitoring.set_local_events(3, f.__code__, E.BRANCH_LEFT | E.BRANCH_RIGHT | E.JUMP)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.monitoring.set_local_events(3, f.__code__, E.BRANCH_LEFT | E.BRAN...')
        try: result = [f(a) for a in (0, 2, None)]
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: result = [f(a) for a in (0, 2, None)]')
        try: sys.monitoring.set_local_events(3, f.__code__, 0)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.monitoring.set_local_events(3, f.__code__, 0)')
        try: sys.monitoring.free_tool_id(3)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.monitoring.free_tool_id(3)')
        try: print('monitoring', 'name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
        try: print('size [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', size)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: size')
        try: print('result [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', result)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: result')
        try: print('seen [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', seen)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name, size in [(name, size) for name in ('while continue', 'if el...")
