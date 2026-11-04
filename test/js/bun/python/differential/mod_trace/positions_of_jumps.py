# The places (co_positions()) of the jumps back in loops, which is where a signal handler finds the frame, and a traceback shows it; that
# other jumps have a place too; which instructions co_exceptiontable says are covered.
import dis, itertools, signal, sys, traceback, types
SOURCES = r'''
while a:
    pass
---
while a:
    x = 1
---
while a:
    x += 1
    y = x
---
while a:
    f(x)
---
while a:
    x.y = 1
---
while a:
    x[0] = f()
---
while a:
    a, b = b, a
---
while a:
    del x
---
while a:
    import os
---
while a:
    from os import path as p, sep
---
while a:
    assert x
---
while a:
    x: int = 1
---
while a:
    global g
    g = 1
---
while a:
    def f(): pass
---
while a:
    class C: pass
---
while a:
    @d
    def f(): pass
---
while a:
    "doc"
---
while a:
    x
---
while a:
    ...
---
while a:
    (yield)
---
while a:
    x = yield 1
---
while a:
    await x
---
for i in a:
    pass
---
for i in a:
    x = i
    y = x
---
for i in a:
    if i:
        x = 1
---
for i in a:
    if i:
        x = 1
    else:
        y = 2
---
for i in a:
    if i:
        x = 1
    elif j:
        y = 2
---
for i in a:
    if i:
        continue
    x = 2
---
for i in a:
    if i: continue
---
for i in a:
    continue
---
for i in a:
    try:
        x = 1
    finally:
        y = 2
---
for i in a:
    try:
        x = 1
    except E:
        y = 2
---
for i in a:
    try:
        x = 1
    except E as e:
        y = 2
---
for i in a:
    try:
        x = 1
    except E:
        y = 2
    else:
        z = 3
---
for i in a:
    try:
        x = 1
    except* E:
        y = 2
---
for i in a:
    with c:
        x = 1
---
for i in a:
    with c as d, e as f:
        x = 1
---
for i in a:
    with c:
        continue
---
for i in a:
    try:
        continue
    finally:
        y = 2
---
while a:
    for i in b:
        x = i
---
while a:
    while b:
        x = i
---
for i in a:
    for j in b:
        pass
    else:
        z = 1
---
for i in a:
    match i:
        case 1:
            x = 1
        case [p, q]:
            y = 2
---
for i in a:
    match i:
        case 1:
            x = 1
        case _:
            y = 2
---
for i in a:
    x = [j for j in i]
---
x = [i for i in a]
---
x = [i for i in a if i]
---
x = [i + 1 for i in a if i if j]
---
x = [(i, j) for i in a for j in b]
---
x = {i for i in a if i}
---
x = {i: j for i in a if i}
---
x = (i for i in a if i)
---
x = any(i for i in a if i)
---
x = [i async for i in a]
---
async for i in a:
    x = i
---
async for i in a:
    if i:
        x = 1
---
for i in a:
    async with c:
        x = 1
---
for i in a:
    x = (1 if i
         else 2)
---
for i in a:
    x = (i and
         j)
---
for i in a:
    f(i,
      j)
---
for i in a:
    if (i and
        j):
        x = 1
---
for i in a:
    return_ = 1
    if i: break
---
for i in a:
    if i: break
    else: x = 1
---
while a and b:
    x = 1
---
while not a:
    x = 1
---
while True:
    x = 1
---
while 1:
    if x: break
---
while (a,
       b):
    x = 1
---
for i in a:
    lambda: 1
---
for i in a:
    x = lambda: 1
---
for i in a:
    print(i); y = 1
---
for i in a: x = 1
---
while a: x = 1; y = 2
---
for i in a:
    raise_ = 1
    if i:
        raise E
---
for i in a:
    if i:
        return 1
---
for i in a:
    type X = int
---
for i in a:
    x = f"{i}"
---
for i in a:
    x = i[1:2]
---
for i in a:
    x[1:2] = i
---
for i in a:
    x, *y = i
---
for i in a:
    x = y = i
---
for i in a:
    x.y += 1
---
for i in a:
    x[i] += 1
---
for i in a:
    nonlocal_ = i
    del x.y, z[0]
---
for i in a:
    x += i
---
for i in a:
    x -= (i +
          1)
---
for i in a:
    global g_
    g_ += i
---
for i in a:
    try:
        if i:
            x = 1
    except E:
        pass
---
for i in a:
    if i:
        try:
            if i:
                x = 1
        except E:
            pass
    else:
        y = 1
    z = 1
'''.split('---\n')

BACK = {dis.opmap['JUMP_BACKWARD']}


def walk(code):
    yield code
    for constant in code.co_consts:
        if isinstance(constant, types.CodeType):
            yield from walk(constant)


for source in SOURCES:
    text = 'async def function():\n' + ''.join('    ' + line + '\n' for line in source.strip('\n').split('\n'))
    try:
        module = compile(text, '<test>', 'exec')
    except SyntaxError as e:
        print('SyntaxError', e, repr(source))
        continue
    print(source.strip('\n'))
    for code in walk(module):
        positions = list(code.co_positions())
        raw = code.co_code
        found = sorted({positions[i // 2] for i in range(0, len(raw), 2) if raw[i] in BACK and positions[i // 2][0] is not None}, key=repr)
        if found:
            print('   ', code.co_name, found)


print('--- where a signal finds a loop')


class Stop(Exception):
    pass


def handler(signum, frame):
    raise Stop


def w1():
    while True:
        pass


def w2():
    x = 0
    while True:
        x += 1
        y = x


def w3():
    x = 0
    while x >= 0:
        x += 1
        y = [x,
             x]


def f1():
    for i in itertools.count():
        pass


def f2():
    for i in itertools.count():
        if i < 0:
            x = 1


def f3():
    for i in itertools.count():
        if i >= 0:
            continue
        x = 2


def f4():
    for i in itertools.count():
        try:
            x = 1
        finally:
            y.z = 2


class y:
    pass


def c1():
    return [i for i in itertools.count() if i < 0]


signal.signal(signal.SIGALRM, handler)
for function in (w1, w2, w3, f1, f2, f3, f4, c1):
    signal.setitimer(signal.ITIMER_REAL, 0.01)
    try:
        function()
    except Stop as e:
        print(function.__name__)
        lines = traceback.format_exception(e)
        print(''.join(lines[2].splitlines(True)[1:]), end='')

print('--- every jump has a place')


def threaded():
    x = 0
    v = 1
    match v:
        case 1:
            if x < 0:
                x = 1
        case 2:
            if x < 0:
                x = 1
    x += 1


def nested(a, b, c):
    if a:
        if b:
            x = 1
        elif c:
            while c:
                c -= 1
        else:
            for i in b:
                if i:
                    break
    else:
        try:
            if b:
                x = 2
        except E:
            x = 3
    return x


for function in (threaded, nested):
    print(function.__name__, sorted({instruction.positions[:] for instruction in dis.get_instructions(function) if instruction.opname in ('POP_JUMP_IF_FALSE', 'POP_JUMP_IF_TRUE', 'FOR_ITER')}),
          all(instruction.positions.lineno for instruction in dis.get_instructions(function) if instruction.opcode in dis.hasjump))

print('--- what a handler covers')


def covered(items):
    try:
        for x in items:
            if x < 0:
                raise ValueError(x)
    except KeyboardInterrupt:
        return 'handled'


bytecode = dis.Bytecode(covered)
print(len(bytecode.exception_entries) > 0, all(any(entry.start <= instruction.offset < entry.end for entry in bytecode.exception_entries) for instruction in bytecode if instruction.opcode in dis.hasjump))
entries = bytecode.exception_entries
print(all(a.end <= b.start for a, b in zip(entries, entries[1:])), all(entry.start < entry.end <= len(covered.__code__.co_code) and entry.target < len(covered.__code__.co_code) for entry in entries))
print(dis.Bytecode(threaded).exception_entries)
