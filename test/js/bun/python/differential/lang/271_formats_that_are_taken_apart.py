# 'a%sb' % (x,): what the compiler makes of a literal format and a tuple that is written out.
import itertools
import sys

UNITS = ['%s', '%r', '%a', '%d', '%%', '%5s', '%-5s', '%05s', '%+5s', '% 5s', '%#5s', '%.3s', '%5.3s', '%-5.3r', '%.s', '%5.s', '%0s', '%00s', '%-0s', '%99s', '%100s',
         '%.99s', '%.100s', '%099s', '%0100s', '%-+ #05.2a', '%*s', '%.*s', '%(k)s', '%ls', '%c', '%', '%5', '%5.', '%-', 'x', '', 'Ā', '{', '}', '{0}', '%S', '%5%', '%s%%']


class Odd(str):
    def __str__(self):
        return 'str of Odd'

    def __repr__(self):
        return 'repr of OddĀ'

    def __format__(self, spec):
        return 'format of Odd'


VALUES = {'a': 'text', 'b': 12, 'c': Odd('odd'), 'd': None}


def attempt(source):
    code = compile(source, '<test>', 'eval')
    try:
        value = eval(code, dict(VALUES))
    except Exception as e:
        value = type(e).__name__ + ': ' + str(e)
    print(ascii(source), ascii(tuple('code' if hasattr(c, 'co_code') else c for c in code.co_consts)), ascii(code.co_names), ascii(value))


for first, second in itertools.chain(zip(UNITS, UNITS[1:] + UNITS[:1]), zip(UNITS, UNITS[7:] + UNITS[:7]), ((unit, '%s') for unit in UNITS), (('%r', unit) for unit in UNITS)):
    for items in ('()', '(a,)', '(a, b)', '(c, 1)'):
        attempt(repr(first + '|' + second) + ' % ' + items)
for unit in UNITS:
    for items in ('(a, b, c)', '(*a,)', 'a', '[a]', '(a,) + ()', '((a, b),)', "('lit',)", '(1.5,)', '(None,)', '(d,)', '(a)'):
        attempt(repr(unit) + ' % ' + items)
for source in ("('%s' % (a,)) % ()", "'%s' % ('%s' % (a,),)", "'%s' % (a,) + 'x'", "'x' + '%s' % (a,)", "('%s' % (a,)).upper()", "('%s' % (a,))[1:]", "'%s' '%s' % (a, b)", "('%' + 's') % (a,)",
               "b'%s' % (b'x',)", "f'%s' % (a,)", "'%s' % (a,) % ()", "'%%s' % () % (a,)", "2 * '%s' % (a, b)", "'%s' * 2 % (a, b)", "-'%s' % (a,)", "not '%s' % (a,)", "'' % ()", "'%%' % ()",
               "'a' % ()", "['%s' % (x,) for x in a]", "(lambda: '%r' % (a,))()", "'%s' % (a if b else c,)", "'%5s%s' % (a, '%s' % (b,))"):
    attempt(source)


# The pieces of text are on no line.
def lines_of(source):
    namespace = dict(VALUES)
    exec(compile(source, '<test>', 'exec'), namespace)
    f = namespace['f']
    seen = []

    def trace(frame, event, arg):
        if frame.f_code is f.__code__:
            seen.append((event, frame.f_lineno))
        return trace
    sys.settrace(trace)
    try:
        f()
    finally:
        sys.settrace(None)
    print(ascii(source), seen, sorted({line for _, _, line in f.__code__.co_lines() if line}))


for body in ("x = ('p%s'\n         % (a,))", "x = ('%s'\n         % (a,))", "x = ('p%sq'\n         % (\n             a,\n         ))", "x = ('p%sq%rr'\n         % (a,\n            b))",
             "return ('p%s'\n            % (a,))", "x = 1\n    y = ('p%s'\n         % (a,))", "x = ('p'\n         % ())", "x = ('p%5s'\n         % (a,))", "g('p%s'\n      % (a,))",
             "x = ('p%s' %\n         (a,)).upper()", "x = [\n        'p%s' % (a,),\n        'q%s' % (b,),\n    ]", "if ('p%s'\n        % (a,)):\n        x = 1", "for i in range(2):\n        x = ('p%s'\n             % (a,))",
             "x = ('p%d'\n         % (b,))"):
    lines_of('def g(v): pass\ndef f():\n    ' + body + '\n')


# Where that line is.
def run(source):
    seen = []
    def trace(frame, event, arg):
        if frame.f_code.co_filename == '<test>':
            seen.append((event, frame.f_code.co_name, frame.f_lineno))
        return trace
    namespace = {'a': 'text', 'b': 12, 'c': 0}
    code = compile(source, '<test>', 'exec')
    sys.settrace(trace)
    try:
        exec(code, namespace)
    finally:
        sys.settrace(None)
    print(ascii(source), seen)

F = "('p%s'\n  % (a,))"
for source in (
    "x = " + F,
    "\n\nx = " + F,
    "'doc'\nx = " + F,
    "import sys\nx = " + F,
    "class C:\n    x = " + F,
    "class C:\n    'doc'\n    x = " + F,
    "def f():\n    'doc'\n    x = " + F + "\nf()",
    "def f():\n    yield " + F + "\nlist(f())",
    "f = lambda: " + F + "\nf()",
    "f = (lambda:\n     " + F + ")\nf()",
    "def f():\n    if c:\n        x = " + F + "\n    else:\n        x = " + F + "\nf()",
    "def f():\n    if b:\n        x = " + F + "\n    else:\n        x = " + F + "\nf()",
    "def f():\n    if c:\n        pass\n    x = " + F + "\nf()",
    "def f():\n    if b:\n        y = 1\n    x = " + F + "\nf()",
    "def f():\n    if b:\n        y = 1\n    else:\n        y = 2\n    x = " + F + "\nf()",
    "def f():\n    try:\n        x = " + F + "\n    finally:\n        y = " + F + "\nf()",
    "def f():\n    try:\n        1 / c\n    except ZeroDivisionError:\n        x = " + F + "\nf()",
    "def f():\n    while True:\n        x = " + F + "\n        break\nf()",
    "def f():\n    for i in (1, 2):\n        pass\n    x = " + F + "\nf()",
    "def f():\n    for i in (1, 2):\n        pass\n    else:\n        x = " + F + "\nf()",
    "def f():\n    with open('/dev/null'):\n        x = " + F + "\nf()",
    "def f():\n    with open('/dev/null'):\n        pass\n    x = " + F + "\nf()",
    "def f():\n    pass\n    x = " + F + "\nf()",
    "def f():\n    global g\n    x = " + F + "\nf()",
    "def f(y=1):\n    del y\n    x = " + F + "\nf()",
    "def f():\n    return " + F + "\nf()",
    "def f():\n    x = b and " + F + "\nf()",
    "def f():\n    x = c or " + F + "\nf()",
    "def f():\n    x = (1 if c else\n " + F + ")\nf()",
    "def f():\n    x = [" + F + " for i in (1, 2)]\nf()",
    "def f():\n    x = list(" + F + " for i in (1, 2))\nf()",
    "def f():\n    match b:\n        case 12:\n            x = " + F + "\nf()",
    "def f():\n    assert b, " + F + "\nf()",
    "def f():\n    x = " + F + "\n    y = " + F + "\nf()",
    "async def f():\n    x = " + F + "\ntry:\n    f().send(None)\nexcept StopIteration:\n    pass",
    "x = f''",
    "x = '' % ()",
):
    run(source)
for source in ("x = f''", "x = '' % ()", "x = f'' + 'a'", "f''", "x = f'{a}' f''", "x = '%s' % ('',)"):
    print(source, compile(source, '<test>', 'exec').co_consts)
