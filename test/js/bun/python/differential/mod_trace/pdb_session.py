# pdb, told what to do through its stdin.
import gc
import io
import pdb
import sys
import os as _os, bdb as _bdb
LIB = _os.path.dirname(_bdb.__file__)


def helper(a):
    b = a * 2
    return b


def target(n):
    total = 0
    for i in range(n):
        total += helper(i)
    try:
        raise ValueError('boom')
    except ValueError:
        total += 100
    return total


def session(title, commands, function=target, *args):
    print('=====', title)
    out = io.StringIO()
    debugger = pdb.Pdb(stdin=io.StringIO('\n'.join(commands) + '\n'), stdout=out, nosigint=True, readrc=False)
    debugger.use_rawinput = False
    # What importing has left behind goes now: the debugger would stop in a callback of a weak reference that a collection runs.
    gc.collect()
    try:
        result = debugger.runcall(function, *args)
    except BaseException as e:
        result = 'raised %r' % (e,)
    print(out.getvalue().replace(__file__, 'FILE').replace(LIB, 'LIB'))
    print('result:', result)


first = target.__code__.co_firstlineno
helper_first = helper.__code__.co_firstlineno

session('step and next', ['n', 'n', 'n', 's', 'p a', 'n', 'p b', 'r', 'n', 'p total', 'c'], target, 2)
session('breakpoint', ['b %d' % (helper_first + 1), 'c', 'p a', 'w', 'c', 'p a', 'cl 1', 'c'], target, 3)
session('conditional breakpoint', ['b helper, a == 2', 'c', 'p a', 'b', 'c'], target, 4)
session('temporary breakpoint', ['tbreak %d' % (first + 3), 'c', 'p i', 'c'], target, 2)
session('until and jump', ['until %d' % (first + 4), 'p total', 'j %d' % (first + 8), 'n', 'c'], target, 2)
session('up and down', ['b helper', 'c', 'u', 'p n', 'd', 'p a', 'a', 'cl 1', 'c'], target, 1)
session('assign', ['n', 'n', '!n = 0', 'p n', 'total = 5', 'c'], target, 2)
session('list', ['l %d, %d' % (first, first + 2), 'll', 'c'], helper, 1)
session('return value', ['r', 'retval', 'c'], helper, 4)
session('quit', ['n', 'q'], target, 1)
session('display', ['display total', 'n', 'n', 'n', 'n', 'c'], target, 1)
session('exception', ['b %d' % (first + 5), 'c', 'n', 'n', 'p total', 'c'], target, 0)
session('commands', ['b helper', 'commands 1', 'p a', 'c', 'end', 'c'], target, 2)
session('ignore', ['b helper', 'ignore 1 1', 'c', 'p a', 'cl 1', 'c'], target, 3)


def uses_set_trace():
    x = 1
    pdb.Pdb(stdin=io.StringIO('p x\nn\np y\nc\n'), stdout=sys.stdout, nosigint=True, readrc=False).set_trace()
    y = 2
    return x + y


print('===== set_trace')
gc.collect()
out = sys.stdout
sys.stdout = captured = io.StringIO()
try:
    result = uses_set_trace()
finally:
    sys.stdout = out
print(captured.getvalue().replace(__file__, 'FILE').replace(LIB, 'LIB'))
print(result)


def post_mortem():
    try:
        target('x')
    except TypeError as e:
        out = io.StringIO()
        debugger = pdb.Pdb(stdin=io.StringIO('p n\nu\nq\n'), stdout=out, nosigint=True, readrc=False)
        debugger.use_rawinput = False
        debugger.reset()
        debugger.interaction(None, e.__traceback__)
        print(out.getvalue().replace(__file__, 'FILE').replace(LIB, 'LIB'))


print('===== post mortem')
post_mortem()
