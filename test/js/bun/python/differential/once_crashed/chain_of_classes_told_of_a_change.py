# A class changes, and thousands of classes derive from it, each from the one before. They were told one from inside the
# other: on the stack of a thread that was the end of the process. (On the main thread it took 400,000.)
import collections.abc
import gc
import threading

# With the MROs that Python makes a chain of 12,000 takes 72 million entries.
class Short(type):
    calls = 0
    fails_at = None
    def mro(cls):
        Short.calls += 1
        if Short.calls == Short.fails_at:
            raise ValueError('no MRO')
        return [cls, object]

def chain(length):
    class Root(First): pass
    last = Root
    for i in range(length):
        last = Short('C', (last,), {})
    return Root, last

class First(metaclass=Short): pass
class Second(metaclass=Short): pass

def kind(o):
    match o:
        case []: return 'sequence'
        case {}: return 'mapping'
    return 'neither'

def change():
    Root, last = chain(12000)
    Root.x = 1
    print('Root.x = 1', Root.x, getattr(last, 'x', 'none'))
    Root.__len__ = lambda self: 3
    print('Root.__len__ = f', len(Root()), hasattr(last, '__len__'))
    Root.__new__ = lambda cls: object.__new__(cls)
    print('Root.__new__ = f', type(Root()).__name__, type(last()).__name__)
    del Root.x, Root.__len__, Root.__new__
    print('del', hasattr(Root, 'x'), hasattr(Root, '__len__'), type(last()).__name__)
    # A class registered as a sequence: all that derive from it are sequences.
    last.__len__ = lambda self: 0
    print('before', kind(last()))
    collections.abc.Sequence.register(Root)
    print('Sequence.register(Root)', kind(last()))
    collections.abc.Mapping.register(Root)
    print('Mapping.register(Root)', kind(last()))
    # Each of them tells all that derive from it when it gets its MRO, so this one takes the square of the length.
    Root, last = chain(2000)
    Short.calls = 0
    Root.__bases__ = (Second,)
    print('Root.__bases__ = (Second,)', Root.__bases__, Root.__base__, Short.calls, Second.__subclasses__())
    # An mro() raises: what the others gave is taken back.
    Short.calls = 0
    Short.fails_at = 301
    try:
        Root.__bases__ = (First,)
    except ValueError as e:
        print('Root.__bases__ = (First,)', e, Root.__bases__, Root.__base__, Short.calls, First.__subclasses__()[1:], Second.__subclasses__())
    Short.fails_at = None

threading.stack_size(256 * 1024)
thread = threading.Thread(target=change)
thread.start()
thread.join()

# __bases__ that lead from a class to itself, which neither the MRO shows, being short, nor __base__: A is the second base of B.
class A(metaclass=Short): pass
class X(metaclass=Short): pass
class B(X, A): pass
class C(B): pass
for target, bases in ((A, (B,)), (A, (C,)), (A, (X, C)), (X, (B,)), (A, (A,)), (A, (X,)), (A, (object,))):
    try:
        target.__bases__ = bases
        print(target.__name__, [b.__name__ for b in bases], 'assigned')
    except TypeError as e:
        print(target.__name__, [b.__name__ for b in bases], e)
print([b.__name__ for b in A.__bases__], [b.__name__ for b in B.__bases__], [b.__name__ for b in X.__bases__])

def names(classes):
    return [c.__name__ for c in classes]

def assign(target, bases):
    try:
        target.__bases__ = bases
        return 'assigned'
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)

# The same by an assignment from inside the assignment. A key with the hash of '__del__' is asked in the course of it:
import warnings
warnings.simplefilter('ignore')
class Key:
    act = None
    def __hash__(self): return hash('__del__')
    def __eq__(self, other):
        act, Key.act = Key.act, None
        if act:
            act()
        return False
class O1: pass
class O2: pass
A = type('A', (O1,), {Key(): 1})
class B(O2): pass
Key.act = lambda: print('from inside, B.__bases__ = (A,):', assign(B, (A,)))
print('A.__bases__ = (B,):', assign(A, (B,)))
print(names(A.__bases__), names(B.__bases__), names(A.__mro__), names(B.__mro__))
print('A.__bases__ = (O1,):', assign(A, (O1,)), names(A.__mro__), names(B.__mro__))

# and an mro() further down gives B the class A for a base, which no longer has B for one, and raises. A does not get B back: it keeps X.
class Hooked(type):
    plan = {}
    def mro(cls):
        act = Hooked.plan.pop(cls.__name__, None)
        if act:
            act()
        return type.mro(cls)
class X(metaclass=Hooked):
    def __del__(self):
        print('X.__del__ of', type(self).__name__)
class O(metaclass=Hooked): pass
class B(O): pass
class A(B): pass
class S(A): pass
a, s = A(), S()
def act():
    print('from inside, B.__bases__ = (A,):', assign(B, (A,)))
    raise KeyError('the outer one fails')
Hooked.plan['S'] = act
print('A.__bases__ = (X,):', assign(A, (X,)))
print(names(A.__bases__), names(B.__bases__), names(A.__mro__), names(B.__mro__), names(A.__subclasses__()), names(B.__subclasses__()))
# All that follows an assignment has been done: the instances that there were have the __del__ of X.
del a
gc.collect()
del s
gc.collect()
print('A.__bases__ = (X,):', assign(A, (X,)), names(S.__mro__))
print('B.__bases__ = (A,):', assign(B, (A,)), names(B.__mro__))

# The same where the old bases were themselves those of an assignment that is still under way. Nothing is taken back: C6 has the bases and the MRO of the assignment that failed,
# and what is read from a class follows the classes in its MRO, whichever they are.
class C2(metaclass=Hooked): pass
class C5(C2): w = 'C5'
class C4(metaclass=Hooked): w = 'C4'
class C6(metaclass=Hooked): pass
class C3(C6): pass
def first():
    Hooked.plan['C3'] = second
    print('from inside, C6.__bases__ = (C4,):', assign(C6, (C4,)))
def second():
    print('from inside that, C5.__bases__ = (C3,):', assign(C5, (C3,)))
    raise KeyError('the second fails')
Hooked.plan['C3'] = first
print('C6.__bases__ = (C5,):', assign(C6, (C5,)))
every = (C2, C3, C4, C5, C6)
for c in every:
    print(c.__name__, names(c.__bases__), names(c.__mro__), names(c.__subclasses__()), c.__base__.__name__)
def by_mro(c):
    return next((k.__dict__['w'] for k in c.__mro__ if 'w' in k.__dict__), None)
def read():
    return [getattr(c, 'w', None) for c in every], [getattr(c, 'w', None) == by_mro(c) for c in every]
print(*read())
C5.w, C4.w = 'C5 changed', 'C4 changed'
print(*read())
del C5.w
print(*read())
del C4.w
print(*read())
C2.w = 'C2'
print(*read())
print('END')
