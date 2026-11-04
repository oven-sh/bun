# Where a call is when it returns: f_lineno of the frame afterwards (untraced), and what a trace function sees.
import sys
SHAPES = r'''
def simple(x):
    keep()
    a = 1
---
def if1(x):
    keep()
    if x:
        a = 1
---
def ifelse(x):
    keep()
    if x:
        a = 1
    else:
        a = 2
---
def ifelif(x):
    keep()
    if x == 1:
        a = 1
    elif x == 0:
        a = 2
---
def nestedif(x):
    keep()
    if x:
        if x > 5:
            a = 1
    else:
        if x < 0:
            a = 2
---
def while1(x):
    keep()
    while x:
        x -= 1
---
def whileelse(x):
    keep()
    while x:
        x -= 1
    else:
        a = 1
---
def whilebreak(x):
    keep()
    while True:
        if x:
            break
        x = 1
---
def for1(x):
    keep()
    for i in range(x):
        a = i
---
def forelse(x):
    keep()
    for i in range(x):
        a = i
    else:
        b = 1
---
def forbreak(x):
    keep()
    for i in range(3):
        if i == x:
            break
---
def forcontinue(x):
    keep()
    for i in range(2):
        if i == x:
            continue
        a = 1
---
def try1(x):
    keep()
    try:
        a = 1 / x
    except ZeroDivisionError:
        b = 2
---
def try2(x):
    keep()
    try:
        a = 1 / x
    except ZeroDivisionError as e:
        b = 2
---
def tryelse(x):
    keep()
    try:
        a = 1 / x
    except ZeroDivisionError:
        b = 2
    else:
        c = 3
---
def tryfinally(x):
    keep()
    try:
        a = x
    finally:
        b = 2
---
def tryexceptfinally(x):
    keep()
    try:
        a = 1 / x
    except ZeroDivisionError:
        b = 2
    finally:
        c = 3
---
def tryifhandler(x):
    keep()
    try:
        a = 1 / x
    except ZeroDivisionError:
        if x == 0:
            b = 2
---
def tryiffalse(x):
    keep()
    try:
        if False:
            pass
    except Exception:
        X
---
def tryif(x):
    keep()
    try:
        if x:
            a = 1
    except Exception:
        X
---
def trynest(x):
    keep()
    try:
        try:
            a = 1 / x
        except ZeroDivisionError:
            b = 1
    except ValueError:
        c = 2
---
def trystar(x):
    keep()
    try:
        a = 1 / x
    except* ZeroDivisionError:
        b = 2
---
def trystar2(x):
    keep()
    try:
        a = 1 / x
    except* ZeroDivisionError as e:
        b = 2
    except* ValueError:
        c = 3
---
def with1(x):
    keep()
    with cm():
        a = x
---
def with2(x):
    keep()
    with cm() as c, cm() as d:
        a = x
---
def withif(x):
    keep()
    with cm():
        if x:
            a = x
---
def withsuppress(x):
    keep()
    with cm(True):
        a = 1 / x
---
def match1(x):
    keep()
    match x:
        case 0:
            a = 1
        case 1:
            a = 2
---
def match2(x):
    keep()
    match x:
        case 0:
            a = 1
        case _:
            a = 2
---
def match3(x):
    keep()
    match (1, 2):
        case (a, b) if x:
            c = 1
---
def ifexp(x):
    keep()
    a = (1
         if x
         else 2)
---
def boolop(x):
    keep()
    a = (x
         and
         x + 1)
---
def call(x):
    keep()
    print(
        end=''
    )
---
def comp(x):
    keep()
    [i
     for i in range(x)]
---
def comp2(x):
    keep()
    a = [i
         for i in range(x)
         if i]
---
def ret1(x):
    keep()
    return [1
            for i
            in range(x)]
---
def ret2(x):
    keep()
    return (x
            and
            x + 1)
---
def ret3(x):
    keep()
    if x:
        return 1
    return (
        2
    )
---
def retfinally(x):
    keep()
    try:
        return x
    finally:
        a = 1
---
def retwith(x):
    keep()
    with cm():
        return x
---
def retloop(x):
    keep()
    for i in range(3):
        if i == x:
            return i
---
def passonly(x):
    keep()
    pass
---
def ifpass(x):
    keep()
    if x:
        pass
---
def asserts(x):
    keep()
    assert x >= 0
---
def dels(x):
    keep()
    a = 1
    del a
---
def nesteddef(x):
    keep()
    def inner():
        pass
---
def nestedclass(x):
    keep()
    class A:
        if x:
            a = 1
        else:
            a = 2
---
def lastglobal(x):
    keep()
    global G
    G = x
---
def whiletrue(x):
    keep()
    while True:
        if x:
            return
        x = 1
---
def ifnot(x):
    keep()
    if not x:
        a = 1
    b = (
        2)
---
def forfor(x):
    keep()
    for i in range(x):
        for j in range(x):
            a = 1
---
def ifinloop(x):
    keep()
    for i in range(2):
        if x:
            a = 1
        else:
            a = 2
---
def tryinloop(x):
    keep()
    for i in range(2):
        try:
            a = 1 / x
        except ZeroDivisionError:
            continue
---
def tryfinallyinloop(x):
    keep()
    for i in range(2):
        try:
            if x:
                break
        finally:
            a = 1
---
def elsechain(x):
    keep()
    if x == 5:
        a = 1
    elif x == 6:
        a = 2
    else:
        pass
'''
class cm:
    def __init__(self, suppress=False):
        self.suppress = suppress
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return self.suppress
frames = []
def keep():
    frames.append(sys._getframe(1))
events = []
def tracer(frame, event, arg):
    if frame.f_code.co_filename == '<shape>':
        events.append('%s%s' % (event[0], frame.f_lineno - frame.f_code.co_firstlineno if frame.f_lineno is not None else None))
        return tracer
for source in SHAPES.split('---\n'):
    ns = {'keep': keep, 'cm': cm}
    exec(compile(source.strip('\n') + '\n', '<shape>', 'exec'), ns)
    f = [v for k, v in ns.items() if getattr(v, '__code__', None) and v.__code__.co_filename == '<shape>'][0]
    for x in (0, 1):
        del frames[:], events[:]
        try:
            f(x)
        except Exception as e:
            print('raised', type(e).__name__)
        untraced = frames[0].f_lineno
        sys.settrace(tracer)
        try:
            f(x)
        except Exception as e:
            pass
        sys.settrace(None)
        print(f.__name__, x, 'untraced:', untraced, 'traced:', ' '.join(events))
