# staticmethod, classmethod and property as objects: what they copy from what they wrap, and what they take.
import functools, inspect

def t(label, f):
    try:
        print(label, 'ok', f())
    except Exception as e:
        print(label, type(e).__name__, e)

def f(a: int, b: str = 'x') -> float:
    "the docstring of f"
f.extra = 1

for kind in (staticmethod, classmethod):
    w = kind(f)
    print(kind.__name__, w.__name__, w.__qualname__, w.__doc__, w.__module__, w.__wrapped__ is f, w.__func__ is f, w.__isabstractmethod__)
    print(sorted(w.__dict__), w.__annotations__ == f.__annotations__, hasattr(w, 'extra'))
    print(sorted(w.__dict__))
    t('no argument', lambda: kind())
    t('two', lambda: kind(f, f))
    t('keyword', lambda: kind(function=f))
    t('not callable', lambda: kind(1).__func__)
    t('__new__ alone', lambda: kind.__new__(kind))
    t('__new__ with one', lambda: kind.__new__(kind, f).__func__ is f)
    t('__init__ again', lambda: (w.__init__(len), w.__func__, w.__name__)[1:])
    t('__init__ none', lambda: w.__init__())
    t('__init__ keyword', lambda: w.__init__(function=f))
    w = kind(f)
    t('set', lambda: setattr(w, 'anything', 1) or w.anything)
    t('del annotations', lambda: delattr(w, '__annotations__'))
    w.__annotations__
    t('del annotations', lambda: delattr(w, '__annotations__'))
    t('annotate', lambda: w.__annotate__ is f.__annotate__)
    t('repr', lambda: repr(w).replace(repr(f), 'F'))
    class Sub(kind):
        pass
    print(Sub(f).__name__, type(Sub(f).__get__(None, int)).__name__)
    no_names = kind(functools.partial(f, 1))
    t('of a partial', lambda: no_names.__name__)
    t('of a partial', lambda: sorted(no_names.__dict__))

# Those of the built-in types.
print(str.__dict__['maketrans'].__name__, str.__dict__['maketrans'].__qualname__, type(str.__dict__['maketrans']).__name__)
print(bytes.__dict__['maketrans'].__name__, dict.__dict__['fromkeys'].__name__, type(dict.__dict__['fromkeys']).__name__)
print(str.__dict__['maketrans'].__doc__ == str.maketrans.__doc__, str.__dict__['maketrans'].__wrapped__ is str.maketrans)

# What a class statement wraps by itself.
class C:
    def __new__(cls): return super().__new__(cls)
    def __init_subclass__(cls): pass
    def __class_getitem__(cls, item): return item
for name in ('__new__', '__init_subclass__', '__class_getitem__'):
    w = C.__dict__[name]
    print(name, type(w).__name__, w.__name__, w.__qualname__, sorted(w.__dict__))

# property
def getter(self):
    "from the getter"
p = property(getter)
print(p.__doc__, p.__name__, p.fget is getter, p.fset, p.fdel)
print(property(getter, doc='given').__doc__, property(doc='only').__doc__, property().__doc__)
t('name', lambda: property().__name__)
t('name', lambda: property(functools.partial(getter)).__name__)
def set_name():
    q = property(getter); q.__name__ = 'other'; return q.__name__
t('set name', set_name)
t('__set_name__', lambda: property().__set_name__())
t('__set_name__', lambda: property().__set_name__(1))
t('__set_name__', lambda: property().__set_name__(1, 2, 3))
t('__set_name__', lambda: property().__set_name__(int, 'x'))
t('__set_name__', lambda: property().__set_name__(owner=int, name='x'))
class Slotted(property):
    __slots__ = ()
t('slots, getter doc', lambda: Slotted(getter).__doc__)
t('slots, doc given', lambda: Slotted(getter, doc='given').__doc__)
t('slots, doc None', lambda: Slotted(getter, doc=None).__doc__)
class SlottedWithDoc(property):
    __slots__ = ('__doc__',)
t('a slot for it', lambda: SlottedWithDoc(getter).__doc__)
t('a slot for it', lambda: SlottedWithDoc(getter, doc='given').__doc__)
class WithDict(property):
    "the docstring of the class"
t('class doc', lambda: WithDict().__doc__)
t('class doc', lambda: WithDict(getter).__doc__)
t('class doc', lambda: WithDict(lambda self: 1).__doc__)
t('copies', lambda: [q.__doc__ for q in (p.getter(getter), p.setter(None), p.deleter(None), property(getter, doc='kept').setter(None))])
class D:
    x = property()
    y = property(lambda self: 1)
for action in (lambda: D().x, lambda: setattr(D(), 'x', 1), lambda: delattr(D(), 'x'), lambda: setattr(D(), 'y', 1), lambda: delattr(D(), 'y')):
    t('no accessor', action)
t('unnamed', lambda: property().__get__(D()))
print(property.__doc__[:19], type(property.__dict__['__doc__']).__name__, type(lambda: 0).__doc__[:24])
