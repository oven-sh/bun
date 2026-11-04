# Where in its line an instruction is, however far the jumps around it go: every statement of a body raises in its turn, and the
# traceback says from which column to which.
try: import hashlib, asyncio
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import hashlib, asyncio')

try: SIZES = (1, 5, 6, 7, 12, 30, 45, 90, 400, 1200)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SIZES = (1, 5, 6, 7, 12, 30, 45, 90, 400, 1200)')


try:
    class U:
        def __getitem__(self, key):
            if not key:
                raise KeyError(key)
            return self
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class U:')


# What raises is short, and what comes right behind it has a place of its own.
try:
    def filler(count, indent, first=0):
        return ''.join('%su[c - %d][1][2]\n' % (indent, first + i) for i in range(count))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def filler(count, indent, first=0):')


# {A}, {B}, {C}: bodies whose statements are numbered on from one another.
try: TEMPLATES = {
    'while': '''
def f(c, t):
    n = 0
    while n < 2:
        n += 1
        t[c == -1]
{A8}    return n // (c + 2)
''',
    'if else': '''
def f(c, t):
    n = 0
    if c % 2:
{A8}    else:
{B8}    return n // (c + 2)
''',
    'for else': '''
def f(c, t):
    n = 0
    for i in t[0], t[c == -1]:
{A8}    else:
{B8}    return n // (c + 2)
''',
    'and or not': '''
def f(c, t):
    n = 0
    if t[0] and (c > -5 or t[5]) and not t[c == -1] > 5:
{A8}    return n // (c + 2)
''',
    'try except finally': '''
def f(c, t):
    n = 0
    try:
{A8}        t[c == -1]
    except IndexError:
{B8}        n += t[1]
    finally:
{C8}    return n // (c + 2)
''',
    'with': '''
class M:
    def __enter__(self): return self
    def __exit__(self, *a): return False
def f(c, t):
    n = 0
    with M() as m, M():
{A8}        t[c == -1]
{B4}    return n // (c + 2)
''',
    'match': '''
def f(c, t):
    n = 0
    match c % 3:
        case 0:
{A12}        case 1:
{B12}        case _:
{C12}    return n // (c + 2)
''',
    'loops in loops': '''
def f(c, t):
    n = 0
    for i in range(2):
        for j in range(2):
            if j:
                continue
{A12}        while n:
{B12}            break
{C8}    return n // (c + 2)
''',
    'conditional expressions': '''
def f(c, t):
    n = 0
    for i in range(2):
        n += (t[0] if c else t[c == -1]) if i else (t[0] // (c + 3) if c else 4)
{A8}    return n // (c + 2)
''',
    'generator': '''
def g(c, t):
    n = 0
    for i in range(2):
{A8}        n += yield t[c == -1]
        if n:
{B12}            n -= 1
    return n // (c + 2)
def h(c, t):
    n = yield from g(c, t)
{C4}    return n
def f(c, t):
    n = 0
    for x in h(c, t):
        n += x
    return n
''',
    'coroutine': '''
class A:
    def __init__(self): self.n = 2
    def __aiter__(self): return self
    async def __anext__(self):
        self.n -= 1
        if self.n < 0: raise StopAsyncIteration
        return self.n
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
async def g(c, t):
    n = 0
    async for i in A():
{A8}        n += t[c == -1]
    async with A():
{B8}    return n // (c + 2)
def f(c, t):
    return asyncio.run(g(c, t))
''',
    'class': '''
def f(c, t):
    class C:
        n = 0
        while n < 2:
            n += 1
{A12}        if n:
{B12}        else:
            n = None
    return C.n // (c + 2)
''',
    'comprehension': '''
def f(c, t):
    n = 0
    if t:
{A8}        n += sum([x // (c + 1) for x in t if x or t[c == -3]])
{B8}    return n // (c + 2)
''',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: TEMPLATES = { 'while': ''' def f(c, t): n = 0 while n < 2: n += 1 t[c...")


try: positions = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: positions = {}')


try:
    def where(function, c):
        try:
            function(c, (1,))
        except Exception as e:
            tb = e.__traceback__
            while tb.tb_next and tb.tb_next.tb_frame.f_code.co_filename == '<far>':
                tb = tb.tb_next
            code = tb.tb_frame.f_code
            if code not in positions:
                positions[code] = list(code.co_positions())
            return type(e).__name__, code.co_name, tb.tb_lineno, positions[code][tb.tb_lasti // 2]
        return None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def where(function, c):')


try:
    for name in TEMPLATES:
        for size in SIZES:
            if size == SIZES[-1] and name not in ('while', 'try except finally', 'match', 'generator', 'coroutine'):
                continue
            try: bodies = {}
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bodies = {}')
            for i, letter in enumerate('ABC'):
                for indent in (4, 8, 12):
                    try: bodies['%s%d' % (letter, indent)] = filler(size, ' ' * indent, i * size)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: bodies['%s%d' % (letter, indent)] = filler(size, ' ' * indent, i * size)")
            try: namespace = {'asyncio': asyncio, 'u': U()}
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: namespace = {'asyncio': asyncio, 'u': U()}")
            try: exec(compile(TEMPLATES[name].format(**bodies), '<far>', 'exec'), namespace)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec(compile(TEMPLATES[name].format(**bodies), '<far>', 'exec'), name...")
            try: f = namespace['f']
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: f = namespace['f']")
            try: positions.clear()
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: positions.clear()')
            if size <= 45 and name != 'coroutine':
                try: which = range(-4, 3 * size + 1)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: which = range(-4, 3 * size + 1)')
            else:
                try: which = sorted({-4, -3, -2, -1, 0, 1, size - 1, size, size + 1, 2 * size, 3 * size - 1})
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: which = sorted({-4, -3, -2, -1, 0, 1, size - 1, size, size + 1, 2 * s...')
            try: found = [where(f, c) for c in which]
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: found = [where(f, c) for c in which]')
            try: raised = [x for x in found if x]
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: raised = [x for x in found if x]')
            try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', name)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
            try: print('size [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', size)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: size')
            try: print('len(found) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', len(found))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(found)')
            try: print('len(raised) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', len(raised))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(raised)')
            try: print('without columns:', '[x for x in raised if None in x[3]][:5] [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', [x for x in raised if None in x[3]][:5])
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [x for x in raised if None in x[3]][:5]')
            try: print('hashlib.sha1(repr(found).encode()).hexdigest()[:10] [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', hashlib.sha1(repr(found).encode()).hexdigest()[:10])
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hashlib.sha1(repr(found).encode()).hexdigest()[:10]')
            if size in (1, 7, 1200):
                for x in raised[:6] + raised[-2:]:
                    try: print('   ', 'x [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + ", " + 'x=' + (repr(x) if type(x) in (str, int, float, bytes, bool, type(None)) or (type(x) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in x)) else x.__name__ if type(x) is type else type(x).__name__) + '] =>', x)
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name in TEMPLATES:')

# At the level of a module.
try:
    for size in SIZES:
        try: source = 'n = 0\nfor i in range(3):\n    if i == 1:\n        continue\n' + filler(size, '    ') + 'else:\n    n = -n\nn // (c + 2)\n'
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: source = 'n = 0\\nfor i in range(3):\\n if i == 1:\\n continue\\n' + fill...")
        try: code = compile(source, '<far>', 'exec')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: code = compile(source, '<far>', 'exec')")
        try: found = [where(lambda c, t: exec(code, {'c': c, 't': t, 'u': U()}), c) for c in sorted({-2, 0, 1, size // 2, size - 1})]
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: found = [where(lambda c, t: exec(code, {'c': c, 't': t, 'u': U()}), c...")
        try: print('module', 'size [' + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', size)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: size')
        try: print('found [' + 'size=' + (repr(size) if type(size) in (str, int, float, bytes, bool, type(None)) or (type(size) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in size)) else size.__name__ if type(size) is type else type(size).__name__) + '] =>', found)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: found')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for size in SIZES:')

# A jump that needs more room moves what is behind it, which may put the target of another jump out of that one's reach, and so on. All
# the lengths of the code between them, a few bytes at a time. What comes behind a jump may be code that has no place in the source
# worth noting, or be far away in the source, or be long.
try: GAPS = [lambda indent, count=count: (indent + 'x = 0\n') * count for count in range(14)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: GAPS = [lambda indent, count=count: (indent + 'x = 0\\n') * count for ...")
try: GAPS.append(lambda indent: indent + '# ' + '-' * 1200 + '\n')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: GAPS.append(lambda indent: indent + '# ' + '-' * 1200 + '\\n')")
try: GAPS.append(lambda indent: indent + '# ' + '-' * 1200 + '\n' + (indent + 'x = 0\n') * 11)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: GAPS.append(lambda indent: indent + '# ' + '-' * 1200 + '\\n' + (inden...")
try: GAPS.append(lambda indent: indent + 'u[1][' + ' ' * 300 + '2]\n')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: GAPS.append(lambda indent: indent + 'u[1][' + ' ' * 300 + '2]\\n')")
try: GAPS.append(lambda indent: (indent + 'x = 0\n') * 11 + indent + 'u[1][' + ' ' * 300 + '2]\n')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: GAPS.append(lambda indent: (indent + 'x = 0\\n') * 11 + indent + 'u[1]...")
try: GAPS.append(lambda indent: indent + '# ' + '-' * 1200 + '\n' + indent + 'u[1][' + ' ' * 300 + '2]\n')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: GAPS.append(lambda indent: indent + '# ' + '-' * 1200 + '\\n' + indent...")


try:
    def cascade(far, short, gap):
        source = ('def f(c, t):\n    n = 0\n    while n < 2:\n        n += 1\n        if n == t[0] + 1:\n            if c != -2:\n'
                  + '                x = n\n' * short
                  + '                u[c + 1][1][2]\n                if c != -3:\n                    break\n' + gap(' ' * 16) + '                u[c + 3][1][2]\n'
                  + gap(' ' * 12) + '            u[c + 2][1][2]\n'
                  + gap(' ' * 8) + filler(far, ' ' * 8) + gap(' ' * 4) + '    return u[c + 4][1][2]\n')
        namespace = {'u': U()}
        exec(compile(source, '<far>', 'exec'), namespace)
        positions.clear()
        return [where(namespace['f'], c) for c in (-4, -3, -2, -1, 0, 1, far - 1, far)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cascade(far, short, gap):')


try:
    for far in (12, 60):
        try: results = [cascade(far, short, gap) for short in range(20) for gap in (GAPS if far == 12 else GAPS[::3])]
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: results = [cascade(far, short, gap) for short in range(20) for gap in...')
        try: print('one after another', 'far [' + 'far=' + (repr(far) if type(far) in (str, int, float, bytes, bool, type(None)) or (type(far) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in far)) else far.__name__ if type(far) is type else type(far).__name__) + '] =>', far)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: far')
        try: print('len(results) [' + 'far=' + (repr(far) if type(far) in (str, int, float, bytes, bool, type(None)) or (type(far) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in far)) else far.__name__ if type(far) is type else type(far).__name__) + '] =>', len(results))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(results)')
        try: print('without columns:', '[x for result in results for x in result if x and None in x[3]][:5] [' + 'far=' + (repr(far) if type(far) in (str, int, float, bytes, bool, type(None)) or (type(far) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in far)) else far.__name__ if type(far) is type else type(far).__name__) + '] =>', [x for result in results for x in result if x and None in x[3]][:5])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [x for result in results for x in result if x and None in x[3]][:5]')
        try: print('hashlib.sha1(repr(results).encode()).hexdigest()[:10] [' + 'far=' + (repr(far) if type(far) in (str, int, float, bytes, bool, type(None)) or (type(far) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in far)) else far.__name__ if type(far) is type else type(far).__name__) + '] =>', hashlib.sha1(repr(results).encode()).hexdigest()[:10])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hashlib.sha1(repr(results).encode()).hexdigest()[:10]')
        try: print('   ', 'results[0] [' + 'far=' + (repr(far) if type(far) in (str, int, float, bytes, bool, type(None)) or (type(far) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in far)) else far.__name__ if type(far) is type else type(far).__name__) + '] =>', results[0])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: results[0]')
        try: print('   ', 'results[-1] [' + 'far=' + (repr(far) if type(far) in (str, int, float, bytes, bool, type(None)) or (type(far) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in far)) else far.__name__ if type(far) is type else type(far).__name__) + '] =>', results[-1])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: results[-1]')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for far in (12, 60):')
# Very far away.
try:
    for short in range(0, 20, 2):
        try: print('very far away', 'short [' + 'short=' + (repr(short) if type(short) in (str, int, float, bytes, bool, type(None)) or (type(short) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in short)) else short.__name__ if type(short) is type else type(short).__name__) + '] =>', short)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short')
        try: print("cascade(12, short, lambda indent: indent + '# ' + '-' * (1 << 23 if l... [" + 'short=' + (repr(short) if type(short) in (str, int, float, bytes, bool, type(None)) or (type(short) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in short)) else short.__name__ if type(short) is type else type(short).__name__) + '] =>', cascade(12, short, lambda indent: indent + '# ' + '-' * (1 << 23 if len(indent) == 16 else 1) + '\n'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: cascade(12, short, lambda indent: indent + '# ' + '-' * (1 << 23 if l...")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for short in range(0, 20, 2):')
