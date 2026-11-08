# A key that is no str lies in the dict of a class, has the hash of '__new__', and raises from __eq__ once, at the moment
# when it is decided anew who makes the instances of that class.
#
# For the class that is being made, or whose __new__ or __bases__ are assigned: there is no __new__ then, and no instance
# of it from then on. On the way down from a class above it: the way ends there; that class, and all whose turn has not
# come, stay as they were.
#
# These are CPython's rows, but it cannot be asked for them in one go: on the way down it leaves what the key raised for
# whichever call of a C function comes next and still looks. Each case in a process of its own (the two arguments) comes
# out the same there.
import sys, warnings
warnings.simplefilter('ignore')

class Key:
    armed = False
    says_yes = False
    def __hash__(self): return hash('__new__')
    def __eq__(self, other):
        if Key.armed:
            Key.armed = False
            if Key.says_yes:
                return True
            raise KeyError('once')
        return False

def attempt(f):
    try:
        r = f()
        return r if isinstance(r, str) else type(r).__name__
    except BaseException as e:
        return '%s: %s' % (type(e).__name__, e)

def settle():
    try:
        sys.getrefcount(None)
    except SystemError:
        pass

def f(cls, *args):
    calls.append(cls.__name__)
    return object.__new__(cls)

def world(where):
    class Root: pass
    class Before(Root): pass
    Mid = type('Mid', (Root,), {Key(): 5} if where == 'Mid' else {})
    C1 = type('C1', (Mid,), {Key(): 5} if where == 'C1' else {})
    class D1(C1): pass
    class Beside(Mid): pass
    class After(Root): pass
    return Root, Before, Mid, C1, D1, Beside, After

def set_new(c, v):
    c.__new__ = v
    return 'set'

def del_new(c):
    del c.__new__
    return 'deleted'

def set_bases(c, b):
    c.__bases__ = b
    return 'assigned'

events = {
    'Root.__new__ = f': lambda Root, Mid, C1: set_new(Root, f),
    'Root.__new__ = object.__new__': lambda Root, Mid, C1: set_new(Root, object.__new__),
    'Mid.__new__ = f': lambda Root, Mid, C1: set_new(Mid, f),
    'C1.__new__ = f': lambda Root, Mid, C1: set_new(C1, f),
    'C1.__new__ = object.__new__': lambda Root, Mid, C1: set_new(C1, object.__new__),
    'Root.__bases__ = (object,)': lambda Root, Mid, C1: set_bases(Root, (object,)),
    'Mid.__bases__ = (Root,)': lambda Root, Mid, C1: set_bases(Mid, (Root,)),
    'C1.__bases__ = (Mid,)': lambda Root, Mid, C1: set_bases(C1, (Mid,)),
    'class E(C1)': lambda Root, Mid, C1: attempt(type('E', (C1,), {})),
    'C1()': lambda Root, Mid, C1: attempt(C1),
    'Root.x = 1': lambda Root, Mid, C1: setattr(Root, 'x', 1) or 'set',
}

only = sys.argv[1:]
for where in ('C1', 'Mid'):
    for name, event in events.items():
        if only and only != [where, name]:
            continue
        calls = []
        classes = world(where)
        Root, Mid, C1 = classes[0], classes[2], classes[3]
        Key.armed = True
        try:
            result = event(Root, Mid, C1)
        except BaseException as e:
            result = '%s: %s' % (type(e).__name__, e)
        settle()
        print('the key in', where, '|', name, '|', result, '| not asked' if Key.armed else '|')
        Key.armed = False
        for again in range(2):
            print('   ', [attempt(c) for c in classes], '|', attempt(lambda: C1(1)), '|', attempt(type('Later', (C1,), {})), '|', calls)
            calls.clear()
        print('    Root.x = 1 |', [attempt(c) for c in classes if setattr(Root, 'x', 1) is None], calls)
        calls.clear()
        print('    Root.__new__ = f |', attempt(lambda: set_new(Root, f)), [attempt(c) for c in classes], calls)
        calls.clear()
        print('    del Root.__new__ |', attempt(lambda: del_new(Root)), [attempt(c) for c in classes], calls)

# Two ways lead to D. By the second it is asked again, and the key, which has raised or said that it is the name, says no.
def diamond(where):
    class Root: pass
    Side = type('Side', (), {Key(): 5} if where == 'Side' else {})
    class A(Root): pass
    class B(Root): pass
    D = type('D', (Side, A, B), {Key(): 5} if where == 'D' else {})
    class E(D): pass
    return Root, A, B, D, E

for where in ('D', 'Side'):
    for says_yes in (False, True):
        name = 'it says yes' if says_yes else 'it raises'
        # (What a key of a base has said is remembered here until the class changes.)
        if (where, says_yes) == ('Side', True) or only and only != [where, name]:
            continue
        calls = []
        classes = diamond(where)
        Key.says_yes = says_yes
        Key.armed = True
        try:
            result = set_new(classes[0], f)
        except BaseException as e:
            result = '%s: %s' % (type(e).__name__, e)
        settle()
        print('two ways, the key in', where, '|', name, '|', result, '| not asked' if Key.armed else '|')
        Key.armed = Key.says_yes = False
        print('   ', [attempt(c) for c in classes], '|', [attempt(lambda: c(1)) for c in classes], '|', calls)

# From inside the way down a key lets go of classes that have had their turn, collects, and makes classes under one whose turn has not come; a key of a base of theirs
# raises while they are made, so there is no making instances of them until the way comes to them. It does: also to those that lie where a class lay that is gone.
if not only or only == ['gone', 'and made']:
    import gc

    class RaisesWhileMade:
        raises = False
        def __hash__(self): return hash('__new__')
        def __eq__(self, other):
            if RaisesWhileMade.raises:
                raise KeyError('while it is made')
            return False

    class Acts:
        armed = False
        def __hash__(self): return hash('__new__')
        def __eq__(self, other):
            if Acts.armed:
                Acts.armed = False
                had_their_turn.clear()
                overwrite_the_stack(40)
                for i in range(3):
                    gc.collect()
                RaisesWhileMade.raises = True
                made.extend(type('Made', (Side, Later), {}) for i in range(3000))
                RaisesWhileMade.raises = False
                settle()
            return False

    def overwrite_the_stack(depth):
        return overwrite_the_stack(depth - 1) + len([0] * 8) if depth else 0

    calls = []
    made = []
    class Root: pass
    Side = type('Side', (), {RaisesWhileMade(): 5})
    had_their_turn = [type('Early', (Root,), {}) for i in range(200)]
    Actor = type('Actor', (Root,), {Acts(): 5})
    class Later(Root): pass
    Acts.armed = True
    Root.__new__ = f
    settle()
    print('classes made on the way |', len(made), '|', sorted({attempt(c) for c in made}), '|', attempt(Actor), attempt(Later))
