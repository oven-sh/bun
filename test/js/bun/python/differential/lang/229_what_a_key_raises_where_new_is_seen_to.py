# A key that is no str in the dict of a class is asked whether it is '__new__' when __new__ is assigned in a base of that class, or __bases__.
# What it raises comes out of the assignment, which has taken place. (type.__setattr__ is called as a function: behind a statement CPython leaves
# the exception for the next call that looks.)
import warnings
warnings.simplefilter('ignore')

def g(cls, *args):
    return object.__new__(cls)

def show(what, act):
    try:
        act()
        print(what, '| went through')
    except BaseException as e:
        print(what, '|', type(e).__name__, e, '| cause', repr(e.__cause__), '| context', repr(e.__context__), e.__suppress_context__)

class Key:
    armed = False
    asked = 0
    def __hash__(self):
        return hash('__new__')
    def __eq__(self, other):
        Key.asked += 1
        if Key.armed:
            raise KeyError('from the key')
        return False

class A: pass
class B: pass
class Root(A): pass
class Before(Root): pass
Sub = type('Sub', (Root,), {Key(): 1})
class After(Root): pass
class Under(Sub): pass

Key.armed = True
show('set', lambda: type.__setattr__(Root, '__new__', g))
print(Root.__new__ is g)
show('delete', lambda: type.__delattr__(Root, '__new__'))
print('__new__' in Root.__dict__)
show('__bases__', lambda: type.__setattr__(Root, '__bases__', (B,)))
print(Root.__bases__, Sub.__mro__)
Key.armed = False
show('set', lambda: type.__setattr__(Root, '__new__', g))
print([type(c()).__name__ for c in (Root, Before, Sub, After, Under)])

# A key that assigns again each time it is asked. What ends it is the end of the stack, and that has to end all the assignments it is called from.
class Again:
    asked = 0
    limit = 0
    def __hash__(self):
        return hash('__new__')
    def __eq__(self, other):
        Again.asked += 1
        if Again.asked <= Again.limit:
            type.__setattr__(Top, '__new__', g)
        return False
class Top: pass
Low = type('Low', (Top,), {Again(): 1})
for limit in (0, 1, 2, 5, 18, 10 ** 9):
    Again.asked, Again.limit = 0, limit
    try:
        type.__setattr__(Top, '__new__', g)
        print(limit, 'went through')
    except SystemError as e:
        depth = 0
        while isinstance(e, SystemError):
            depth += 1
            e = e.__cause__
        print(limit, 'SystemError', depth > 100, type(e).__name__)
