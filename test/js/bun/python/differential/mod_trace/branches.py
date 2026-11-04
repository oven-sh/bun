# Which way branches go (BRANCH_LEFT, BRANCH_RIGHT), with the lines of the branch and of where it goes, what co_branches() says, and
# where a tool that follows co_code from there to the next line ends up, as coverage.py does.
import asyncio
import dis
import sys

m = sys.monitoring
E = m.events
TOOL = 1
ev = []
arcs = set()
m.use_tool_id(TOOL, 'test')


def line_of(code, offset):
    for start, end, line in code.co_lines():
        if start <= offset < end:
            return line - code.co_firstlineno if line else None
    return '?'


JUMPS = set(dis.hasjump)
ALWAYS = {dis.opmap[name] for name in ('JUMP_FORWARD', 'JUMP_BACKWARD', 'JUMP_BACKWARD_NO_INTERRUPT')}
BACKWARD = {dis.opmap[name] for name in ('JUMP_BACKWARD', 'JUMP_BACKWARD_NO_INTERRUPT')}
CACHE = dis.opmap['CACHE']
EXTENDED_ARG = dis.opmap['EXTENDED_ARG']


def next_line(code, source, offset):
    """The line the code gets to from `offset`, without another branch: 'exit' if it returns first, None if there is none."""
    bytecode = code.co_code
    from_line = line_of(code, source)
    extended = 0
    seen = set()
    while 0 <= offset < len(bytecode) and offset not in seen:
        seen.add(offset)
        op = bytecode[offset]
        if op == CACHE:
            offset += 2
            continue
        if op == EXTENDED_ARG:
            extended = (extended | bytecode[offset + 1]) << 8
            offset += 2
            continue
        line = line_of(code, offset)
        if line is not None and line != from_line:
            return line
        if op in JUMPS:
            if op not in ALWAYS:
                return None
            after = offset + 2
            while after < len(bytecode) and bytecode[after] == CACHE:
                after += 2
            distance = 2 * (extended | bytecode[offset + 1])
            offset = after - distance if op in BACKWARD else after + distance
            extended = 0
            continue
        if op == dis.opmap['RETURN_VALUE']:
            return 'exit'
        if op == dis.opmap['RERAISE']:
            return None
        extended = 0
        offset += 2
    return None


def recorder(name):
    def record(code, source, destination):
        if code.co_name.startswith('t_'):
            ev.append((name, line_of(code, source), line_of(code, destination)))
            arcs.add((line_of(code, source), next_line(code, source, destination)))
    return record


m.register_callback(TOOL, E.BRANCH_LEFT, recorder('L'))
m.register_callback(TOOL, E.BRANCH_RIGHT, recorder('R'))

def t_break(x):
    for i in x:
        if i:
            break
    return 1
def t_return(x):
    for i in x:
        if i:
            return 2
    return 1
def t_else(x):
    for i in x:
        if i:
            break
    else:
        return 0
    return 1
def t_while(n):
    while n:
        n -= 1
    return n
def t_whileelse(n):
    while n > 0:
        n -= 1
        if n == 5:
            break
    else:
        n = 7
    return n
def t_and(a, b):
    x = a and b
    y = a or b
    return x, y
def t_not(a):
    if not a:
        return 1
    return 2
def t_ifexp(a):
    return 1 if a else 2
def t_chain(a, b, c):
    if a < b < c:
        return 1
    return 2
def t_andor(a, b, c):
    if a and (b or c):
        return 1
    return 2
def t_comp(x):
    return [i for i in x if i]
def t_try(x):
    try:
        x()
    except ValueError:
        return 1
    except (TypeError, KeyError):
        return 2
    return 3
def t_match(x):
    match x:
        case 1:
            return 'one'
        case [a, b]:
            return 'pair'
        case {'k': v}:
            return 'map'
        case str():
            return 'str'
        case None:
            return 'none'
        case int() if x > 5:
            return 'big'
        case _:
            return 'other'
def t_assert(x):
    assert x, 'no'
    return 1
def t_with(x):
    with x:
        pass
    return 1
def t_isnot(x):
    while x is not None:
        x = None
    return x
def t_in(x, y):
    return 1 if x in y else 2
def t_unpack(x):
    for a, b in x:
        if a: continue
        b
    return 1
def t_nested(x):
    for i in x:
        for j in i:
            if j: break
    return 1
class CM:
    def __init__(s, r): s.r = r
    def __enter__(s): return s
    def __exit__(s, *a): return s.r
def rv(): raise ValueError
def rt(): raise TypeError
def rk(): raise KeyError
def t_withraise(cm):
    with cm:
        rv()
    return 1


async def numbers(n):
    for i in range(n):
        yield i


async def t_asyncfor(n):
    async for i in numbers(n):
        x = i
    return n


async def t_asyncforelse(n):
    async for i in numbers(n):
        if i == 1:
            break
    else:
        return 'else'
    return 'end'


def show(f, r):
    print(f.__name__, r)
    print('   ', ev)
    print('   ', sorted(arcs, key=repr))
    del ev[:]
    arcs.clear()


calls = [
    (t_break, ([0, 1, 0],)), (t_break, ([0],)), (t_return, ([0, 1],)), (t_return, ([],)), (t_else, ([0],)), (t_else, ([1],)), (t_while, (2,)),
    (t_whileelse, (2,)), (t_whileelse, (7,)), (t_and, (0, 1)), (t_and, (1, 0)), (t_not, (0,)), (t_not, (1,)), (t_ifexp, (0,)), (t_ifexp, (1,)),
    (t_chain, (1, 2, 3)), (t_chain, (1, 2, 0)), (t_andor, (1, 0, 1)), (t_andor, (0, 0, 0)), (t_andor, (1, 1, 0)), (t_andor, (1, 0, 0)),
    (t_comp, ([0, 1],)), (t_try, (rv,)), (t_try, (rt,)), (t_try, (rk,)), (t_try, (int,)), (t_assert, (1,)), (t_with, (CM(0),)), (t_isnot, (1,)),
    (t_in, (1, [1])), (t_in, (1, [])), (t_unpack, ([(0, 1), (1, 0)],)), (t_nested, ([[0, 1], [0]],)), (t_withraise, (CM(1),)),
]
for f, a in calls:
    m.set_events(TOOL, E.BRANCH_LEFT | E.BRANCH_RIGHT)
    try:
        r = f(*a)
    except Exception as e:
        r = type(e)
    m.set_events(TOOL, 0)
    show(f, r)

for f, a in ((t_asyncfor, 2), (t_asyncfor, 0), (t_asyncforelse, 1), (t_asyncforelse, 3)):
    m.set_events(TOOL, E.BRANCH_LEFT | E.BRANCH_RIGHT)
    r = asyncio.run(f(a))
    m.set_events(TOOL, 0)
    show(f, r)

# match: where a pattern that fails goes first is a matter of layout. Where it gets to is not.
for a in (1, [1, 2], {'k': 1}, 's', None, 9, 2, 2.5, [1]):
    m.set_events(TOOL, E.BRANCH_LEFT | E.BRANCH_RIGHT)
    r = t_match(a)
    m.set_events(TOOL, 0)
    print('t_match', r, sorted(arcs, key=repr))
    del ev[:]
    arcs.clear()

print('co_branches')
for f in (t_break, t_return, t_else, t_while, t_whileelse, t_and, t_not, t_ifexp, t_andor, t_comp, t_try, t_assert, t_isnot, t_in, t_unpack, t_nested, t_asyncfor, t_asyncforelse):
    code = f.__code__
    print(f.__name__, sorted({(line_of(code, a), line_of(code, b), line_of(code, c)) for a, b, c in code.co_branches()}, key=repr))


# Code that is never run has no branches.
def t_dead(x):
    if 0:
        if x:
            return 1
    while 0:
        if x:
            return 2
    if not 1:
        if x:
            return 3
    return 4


print(list(t_dead.__code__.co_branches()), sorted({line - t_dead.__code__.co_firstlineno for _, _, line in t_dead.__code__.co_lines() if line}))

# DISABLE is for one way of one branch.
def once(code, source, destination):
    if code.co_name.startswith('t_'):
        ev.append((line_of(code, source), line_of(code, destination)))
    return m.DISABLE


m.register_callback(TOOL, E.BRANCH_LEFT, once)
m.register_callback(TOOL, E.BRANCH_RIGHT, once)
m.set_events(TOOL, E.BRANCH_LEFT | E.BRANCH_RIGHT)
t_break([0, 0, 1])
t_break([0, 0])
asyncio.run(t_asyncfor(3))
asyncio.run(t_asyncfor(3))
m.set_events(TOOL, 0)
print(ev)
m.free_tool_id(TOOL)
