# staticmethod, classmethod and property as objects: what they copy from what they wrap, and what they take.
try: import functools, inspect
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import functools, inspect')

try:
    def t(label, f):
        try:
            print(label, 'ok', f())
        except Exception as e:
            print(label, type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(label, f):')

try:
    def f(a: int, b: str = 'x') -> float:
        "the docstring of f"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def f(a: int, b: str = 'x') -> float:")
try: f.extra = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.extra = 1')

try:
    for kind in (staticmethod, classmethod):
        try: w = kind(f)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w = kind(f)')
        try: print('kind.__name__ [' + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + '] =>', kind.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kind.__name__')
        try: print('w.__name__ [' + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + '] =>', w.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.__name__')
        try: print('w.__qualname__ [' + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + '] =>', w.__qualname__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.__qualname__')
        try: print('w.__doc__ [' + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + '] =>', w.__doc__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.__doc__')
        try: print('w.__module__ [' + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + '] =>', w.__module__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.__module__')
        try: print('w.__wrapped__ is f [' + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + '] =>', w.__wrapped__ is f)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.__wrapped__ is f')
        try: print('w.__func__ is f [' + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + '] =>', w.__func__ is f)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.__func__ is f')
        try: print('w.__isabstractmethod__ [' + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + '] =>', w.__isabstractmethod__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.__isabstractmethod__')
        try: print('sorted(w.__dict__) [' + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + '] =>', sorted(w.__dict__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(w.__dict__)')
        try: print('w.__annotations__ == f.__annotations__ [' + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + '] =>', w.__annotations__ == f.__annotations__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.__annotations__ == f.__annotations__')
        try: print("hasattr(w, 'extra') [" + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + '] =>', hasattr(w, 'extra'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: hasattr(w, 'extra')")
        try: print('sorted(w.__dict__) [' + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + '] =>', sorted(w.__dict__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(w.__dict__)')
        try: t('no argument', lambda: kind())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('no argument', lambda: kind())")
        try: t('two', lambda: kind(f, f))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('two', lambda: kind(f, f))")
        try: t('keyword', lambda: kind(function=f))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('keyword', lambda: kind(function=f))")
        try: t('not callable', lambda: kind(1).__func__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('not callable', lambda: kind(1).__func__)")
        try: t('__new__ alone', lambda: kind.__new__(kind))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__new__ alone', lambda: kind.__new__(kind))")
        try: t('__new__ with one', lambda: kind.__new__(kind, f).__func__ is f)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__new__ with one', lambda: kind.__new__(kind, f).__func__ is f)")
        try: t('__init__ again', lambda: (w.__init__(len), w.__func__, w.__name__)[1:])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__init__ again', lambda: (w.__init__(len), w.__func__, w.__name__)...")
        try: t('__init__ none', lambda: w.__init__())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__init__ none', lambda: w.__init__())")
        try: t('__init__ keyword', lambda: w.__init__(function=f))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__init__ keyword', lambda: w.__init__(function=f))")
        try: w = kind(f)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w = kind(f)')
        try: t('set', lambda: setattr(w, 'anything', 1) or w.anything)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('set', lambda: setattr(w, 'anything', 1) or w.anything)")
        try: t('del annotations', lambda: delattr(w, '__annotations__'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('del annotations', lambda: delattr(w, '__annotations__'))")
        try: w.__annotations__
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.__annotations__')
        try: t('del annotations', lambda: delattr(w, '__annotations__'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('del annotations', lambda: delattr(w, '__annotations__'))")
        try: t('annotate', lambda: w.__annotate__ is f.__annotate__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('annotate', lambda: w.__annotate__ is f.__annotate__)")
        try: t('repr', lambda: repr(w).replace(repr(f), 'F'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('repr', lambda: repr(w).replace(repr(f), 'F'))")
        class Sub(kind):
            pass
        try: print('Sub(f).__name__ [' + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + '] =>', Sub(f).__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Sub(f).__name__')
        try: print('type(Sub(f).__get__(None, int)).__name__ [' + 'kind=' + (repr(kind) if type(kind) in (str, int, float, bytes, bool, type(None)) or (type(kind) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in kind)) else kind.__name__ if type(kind) is type else type(kind).__name__) + '] =>', type(Sub(f).__get__(None, int)).__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(Sub(f).__get__(None, int)).__name__')
        try: no_names = kind(functools.partial(f, 1))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: no_names = kind(functools.partial(f, 1))')
        try: t('of a partial', lambda: no_names.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('of a partial', lambda: no_names.__name__)")
        try: t('of a partial', lambda: sorted(no_names.__dict__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('of a partial', lambda: sorted(no_names.__dict__))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for kind in (staticmethod, classmethod):')

# Those of the built-in types.
try: print("str.__dict__['maketrans'].__name__ =>", str.__dict__['maketrans'].__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: str.__dict__['maketrans'].__name__")
try: print("str.__dict__['maketrans'].__qualname__ =>", str.__dict__['maketrans'].__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: str.__dict__['maketrans'].__qualname__")
try: print("type(str.__dict__['maketrans']).__name__ =>", type(str.__dict__['maketrans']).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: type(str.__dict__['maketrans']).__name__")
try: print("bytes.__dict__['maketrans'].__name__ =>", bytes.__dict__['maketrans'].__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: bytes.__dict__['maketrans'].__name__")
try: print("dict.__dict__['fromkeys'].__name__ =>", dict.__dict__['fromkeys'].__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: dict.__dict__['fromkeys'].__name__")
try: print("type(dict.__dict__['fromkeys']).__name__ =>", type(dict.__dict__['fromkeys']).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: type(dict.__dict__['fromkeys']).__name__")
try: print("str.__dict__['maketrans'].__doc__ == str.maketrans.__doc__ =>", str.__dict__['maketrans'].__doc__ == str.maketrans.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: str.__dict__['maketrans'].__doc__ == str.maketrans.__doc__")
try: print("str.__dict__['maketrans'].__wrapped__ is str.maketrans =>", str.__dict__['maketrans'].__wrapped__ is str.maketrans)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: str.__dict__['maketrans'].__wrapped__ is str.maketrans")

# What a class statement wraps by itself.
try:
    class C:
        def __new__(cls): return super().__new__(cls)
        def __init_subclass__(cls): pass
        def __class_getitem__(cls, item): return item
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C:')
try:
    for name in ('__new__', '__init_subclass__', '__class_getitem__'):
        try: w = C.__dict__[name]
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w = C.__dict__[name]')
        try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
        try: print('type(w).__name__ [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', type(w).__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(w).__name__')
        try: print('w.__name__ [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', w.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.__name__')
        try: print('w.__qualname__ [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', w.__qualname__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.__qualname__')
        try: print('sorted(w.__dict__) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + '] =>', sorted(w.__dict__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(w.__dict__)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name in ('__new__', '__init_subclass__', '__class_getitem__'):")

# property
try:
    def getter(self):
        "from the getter"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def getter(self):')
try: p = property(getter)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p = property(getter)')
try: print('p.__doc__ =>', p.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__doc__')
try: print('p.__name__ =>', p.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__name__')
try: print('p.fget is getter =>', p.fget is getter)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.fget is getter')
try: print('p.fset =>', p.fset)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.fset')
try: print('p.fdel =>', p.fdel)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.fdel')
try: print("property(getter, doc='given').__doc__ =>", property(getter, doc='given').__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: property(getter, doc='given').__doc__")
try: print("property(doc='only').__doc__ =>", property(doc='only').__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: property(doc='only').__doc__")
try: print('property().__doc__ =>', property().__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: property().__doc__')
try: t('name', lambda: property().__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('name', lambda: property().__name__)")
try: t('name', lambda: property(functools.partial(getter)).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('name', lambda: property(functools.partial(getter)).__name__)")
try:
    def set_name():
        q = property(getter); q.__name__ = 'other'; return q.__name__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def set_name():')
try: t('set name', set_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('set name', set_name)")
try: t('__set_name__', lambda: property().__set_name__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__set_name__', lambda: property().__set_name__())")
try: t('__set_name__', lambda: property().__set_name__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__set_name__', lambda: property().__set_name__(1))")
try: t('__set_name__', lambda: property().__set_name__(1, 2, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__set_name__', lambda: property().__set_name__(1, 2, 3))")
try: t('__set_name__', lambda: property().__set_name__(int, 'x'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__set_name__', lambda: property().__set_name__(int, 'x'))")
try: t('__set_name__', lambda: property().__set_name__(owner=int, name='x'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('__set_name__', lambda: property().__set_name__(owner=int, name='x'))")
try:
    class Slotted(property):
        __slots__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Slotted(property):')
try: t('slots, getter doc', lambda: Slotted(getter).__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('slots, getter doc', lambda: Slotted(getter).__doc__)")
try: t('slots, doc given', lambda: Slotted(getter, doc='given').__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('slots, doc given', lambda: Slotted(getter, doc='given').__doc__)")
try: t('slots, doc None', lambda: Slotted(getter, doc=None).__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('slots, doc None', lambda: Slotted(getter, doc=None).__doc__)")
try:
    class SlottedWithDoc(property):
        __slots__ = ('__doc__',)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SlottedWithDoc(property):')
try: t('a slot for it', lambda: SlottedWithDoc(getter).__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('a slot for it', lambda: SlottedWithDoc(getter).__doc__)")
try: t('a slot for it', lambda: SlottedWithDoc(getter, doc='given').__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('a slot for it', lambda: SlottedWithDoc(getter, doc='given').__doc__)")
try:
    class WithDict(property):
        "the docstring of the class"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithDict(property):')
try: t('class doc', lambda: WithDict().__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('class doc', lambda: WithDict().__doc__)")
try: t('class doc', lambda: WithDict(getter).__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('class doc', lambda: WithDict(getter).__doc__)")
try: t('class doc', lambda: WithDict(lambda self: 1).__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('class doc', lambda: WithDict(lambda self: 1).__doc__)")
try: t('copies', lambda: [q.__doc__ for q in (p.getter(getter), p.setter(None), p.deleter(None), property(getter, doc='kept').setter(None))])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('copies', lambda: [q.__doc__ for q in (p.getter(getter), p.setter(N...")
try:
    class D:
        x = property()
        y = property(lambda self: 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class D:')
try:
    for action in (lambda: D().x, lambda: setattr(D(), 'x', 1), lambda: delattr(D(), 'x'), lambda: setattr(D(), 'y', 1), lambda: delattr(D(), 'y')):
        try: t('no accessor', action)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('no accessor', action)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for action in (lambda: D().x, lambda: setattr(D(), 'x', 1), lambda: d...")
try: t('unnamed', lambda: property().__get__(D()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('unnamed', lambda: property().__get__(D()))")
try: print('property.__doc__[:19] =>', property.__doc__[:19])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: property.__doc__[:19]')
try: print("type(property.__dict__['__doc__']).__name__ =>", type(property.__dict__['__doc__']).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: type(property.__dict__['__doc__']).__name__")
try: print('type(lambda: 0).__doc__[:24] =>', type(lambda: 0).__doc__[:24])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(lambda: 0).__doc__[:24]')
