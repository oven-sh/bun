# The line a frame is on when the function has ended by falling off its end, and what a trace function is told on the way:
# the implicit return is of the line of whatever ran last, whichever way led to it.
import sys, asyncio, contextlib
TRUE = True
FALSE = False
def if1(x):
    x()
    if TRUE:
        pass
def if2(x):
    x()
    if TRUE:
        pass
    else:
        pass
def if3(x):
    x()
    if TRUE:
        pass
    else:
        return None
def if4(x):
    x()
    if not TRUE:
        pass
def loop1(x):
    x()
    for i in range(2):
        pass
def loop2(x):
    x()
    for i in range(2):
        if i:
            break
    else:
        pass
def try1(x):
    x()
    try:
        pass
    except ValueError:
        y = 1
def try2(x):
    x()
    try:
        raise ValueError
    except ValueError:
        y = 1
    else:
        y = 2
def with1(x):
    x()
    with open(__file__) as f:
        pass
def while1(x):
    x()
    n = 0
    while n < 2:
        n += 1
def match1(x):
    x()
    match TRUE:
        case False:
            y = 1
        case True:
            y = 2
        case _:
            y = 3
def nested(x):
    x()
    if TRUE:
        if TRUE:
            y = 1
        else:
            y = 2
    else:
        y = 3
def cond1(x):
    x()
    if (TRUE and
            FALSE):
        pass
def cond2(x):
    x()
    if (FALSE or
            TRUE):
        pass
def cond3(x):
    x()
    while (TRUE and
            FALSE):
        pass
def elif1(x):
    x()
    if FALSE:
        pass
    elif TRUE:
        y = 1
def elif2(x):
    x()
    if FALSE:
        pass
    elif FALSE:
        y = 1
def fin1(x):
    x()
    try:
        y = 0
    finally:
        y = 1
def fin2(x):
    x()
    try:
        try:
            raise ValueError
        finally:
            y = 1
    except ValueError:
        pass
def fin3(x):
    x()
    for i in range(2):
        try:
            continue
        finally:
            y = 1
def with2(x):
    x()
    with contextlib.suppress(ValueError):
        raise ValueError
def with3(x):
    x()
    with contextlib.nullcontext() as a, contextlib.nullcontext() as b:
        y = 1
def with4(x):
    x()
    with (contextlib.nullcontext() as a,
          contextlib.nullcontext() as b):
        y = 1
def loop3(x):
    x()
    for i in range(3):
        if i == 1:
            break
def loop4(x):
    x()
    n = 0
    while True:
        n += 1
        if n > 1:
            break
def loop5(x):
    x()
    for i in range(2):
        for j in range(2):
            pass
def loop6(x):
    x()
    for i in range(2):
        if i:
            continue
        y = 1
def loop7(x):
    x()
    n = 0
    while n < 2:
        n += 1
    else:
        y = 1
def match2(x):
    x()
    match TRUE:
        case False:
            y = 1
def match4(x):
    x()
    match {'a': 1}:
        case {'b': _}:
            y = 1
        case [1, 2]:
            y = 2
def tryelse(x):
    x()
    try:
        y = 0
    except ValueError:
        y = 1
    else:
        if TRUE:
            y = 2
def tryname(x):
    x()
    try:
        raise ValueError
    except ValueError as e:
        y = 1
def assert1(x):
    x()
    assert TRUE, 'no'
def del1(x):
    x()
    y = 1
    del y
def call1(x):
    x()
    print(
        end='')
def doc(x):
    'doc'
    x()
def ann(x):
    x()
    y: int
def pass1(x):
    x()
    pass
def glob(x):
    x()
    global zzz
def ifconst(x):
    x()
    if 0:
        y = 1
def ifconst2(x):
    x()
    if 1:
        y = 1
def whileconst(x):
    x()
    while 0:
        y = 1
def nestedfn(x):
    x()
    def g():
        pass
def nestedcls(x):
    x()
    class C:
        pass
def deco(x):
    x()
    @staticmethod
    def g():
        pass
frame = None
def save():
    global frame
    frame = sys._getframe(1)
fs = [v for k, v in list(globals().items()) if getattr(v, '__code__', None) and v.__code__.co_argcount == 1 and v.__module__ == __name__]
for f in fs:
    f(save)
    events = []
    def tracer(fr, ev, arg):
        if fr.f_code is f.__code__:
            events.append((ev, None if fr.f_lineno is None else fr.f_lineno - f.__code__.co_firstlineno))
        return tracer
    after = frame.f_lineno
    after = None if after is None else after - frame.f_code.co_firstlineno
    sys.settrace(tracer)
    f(lambda: None)
    sys.settrace(None)
    print(f.__name__, after, events)

async def afor(x):
    x()
    async for i in agen():
        pass
async def awith(x):
    x()
    async with contextlib.nullcontext():
        y = 1
async def agen():
    yield 1
def gen1(x):
    x()
    yield 1
    if TRUE:
        pass
for f in (afor, awith):
    asyncio.run(f(save))
    print(f.__name__, frame.f_lineno - frame.f_code.co_firstlineno if frame.f_lineno else None)
list(gen1(save))
print('gen1', frame.f_lineno - frame.f_code.co_firstlineno if frame.f_lineno else None)
