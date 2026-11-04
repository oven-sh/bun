# The lines a trace function is told of in comprehensions and loops that are written over several lines.
import sys
log = []
def tr(frame, event, arg):
    log.append('%s %s %d' % (event[0], frame.f_code.co_name, frame.f_lineno - frame.f_code.co_firstlineno))
    return tr
def run(f):
    del log[:]
    sys.settrace(tr)
    try:
        r = f()
        if hasattr(r, '__next__'):
            r = list(r)
    finally:
        sys.settrace(None)
    print(f.__name__, r)
    print('   ', ' | '.join(log))
y = [1, 2]
z = [3, 4]
def g1():
    return (1
            for
            x
            in
            y)
def l1():
    return [1
            for
            x
            in
            y]
def l2():
    return [
        x
        for x in y
        if x
        > 1
    ]
def l3():
    return [
        (a, b)
        for a in y
        for b in z
    ]
def l4():
    return [
        (a,
         b)
        for a
        in y
        if a
        for b
        in z
        if b
    ]
def g4():
    return (
        (a,
         b)
        for a
        in y
        if a
        for b
        in z
        if b
    )
def d1():
    return {
        k:
        v
        for k, v
        in zip(y, z)
    }
def s1():
    return {
        k
        for (k,
             v)
        in zip(y, z)
    }
def n1():
    return [
        [i
         for i in range(j)]
        for j in y
    ]
def l5():
    r = [x for x in y]
    return r
def l6():
    r = [x
         for x in y]
    return r
def f1():
    for (
        a
    ) in y:
        pass
def f2():
    for a in (
        y
    ):
        b = a
    return b
for f in (g1, l1, l2, l3, l4, g4, d1, s1, n1, l5, l6, f1, f2):
    run(f)
