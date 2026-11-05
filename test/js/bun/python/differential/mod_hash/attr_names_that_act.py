# Names that are instances of classes derived from str, and that raise or act while an attribute is looked up; and who else takes such a name as it is.
# 1. A KeyError out of the dict of the instance, in a store or a deletion, is taken to mean "there is no such attribute", whoever raised it.
# 2. An AttributeError out of the dict of the instance: for getattr() with a default and for hasattr() it says "not in the dict", and the class is still to come.
# 3. The name is hashed first, and the classes to search are taken afterwards: a __hash__ that changes __bases__ is in time, an __eq__ is not.
# 4. A name that gives the object another class: a descriptor hears of the new one, the message names the one that was searched.
# 5. operator.attrgetter() and methodcaller() keep such a name, unless it has a dot in it.
# 6. threading.local asks first whether the name is '__dict__', and looks into the dict of the thread before anything else unless its class is derived.
# 7. object.__setattr__() and __delattr__() refuse classes, and nothing else that has such methods of its own.
# Every object is of a class of its own, made anew for each row: how often a key is asked must not depend on what other instances have had.
import decimal, functools, operator, threading, types, weakref

log = []
def show(label, function):
    del log[:]
    try:
        result = ('returned', function())
    except BaseException as e:
        result = (type(e).__name__, e.args, type(getattr(e, 'name', None)).__name__, getattr(e, 'obj', None) is not None, type(e.__context__).__name__, type(e.__cause__).__name__)
    print(label, result, log)

class Logs(str):
    def __hash__(self): log.append('hash'); return str.__hash__(self)
    def __eq__(self, other): log.append('eq(%s %r)' % (type(other).__name__, str(other))); return str.__eq__(self, other)
class Plain(str): pass
class Other(str):
    "Finds what is under 'other'."
    def __hash__(self): log.append('hash'); return hash('other')
    def __eq__(self, other): log.append('eq(%r)' % str(other)); return str(other) == 'other'
class SaysYes(str):
    def __hash__(self): log.append('hash'); return str.__hash__(self)
    def __eq__(self, other): log.append('eq(%r)' % str(other)); return True

def raises_at_hash(n, make):
    class Name(str):
        def __hash__(self):
            log.append('hash')
            if log.count('hash') == n: raise make()
            return str.__hash__(self)
        def __eq__(self, other): log.append('eq'); return str.__eq__(self, other)
    return Name('attr')
def raises_in_eq(make):
    class Name(str):
        __hash__ = str.__hash__
        def __eq__(self, other): log.append('eq'); raise make()
    return Name('attr')

def own():
    class C: pass
    o = C(); o.attr = 'own'; return o
def own_and_class():
    class C: attr = 'of the class'
    o = C(); o.attr = 'own'; return o
def own_and_method():
    class C:
        def attr(self): return 'called'
    o = C(); o.__dict__['attr'] = 'own'; return o
def own_and_property():
    class C:
        attr = property(lambda self: 'property')
    o = C(); o.__dict__['attr'] = 'own'; return o
def empty_slot():
    class C: __slots__ = ('attr',)
    return C()
def with_hook():
    class C:
        def __getattr__(self, name): return ('hook', type(name).__name__)
    o = C(); o.attr = 'own'; return o

class SubKeyError(KeyError): pass
print('-- 1')
for make in (lambda: KeyError('k'), lambda: KeyError(), lambda: SubKeyError('s'), lambda: LookupError('l'), lambda: IndexError('i'), lambda: AttributeError('a'), lambda: ValueError('v')):
    what = repr(make())
    for where, name in (('second hash', lambda: raises_at_hash(2, make)), ('eq', lambda: raises_in_eq(make))):
        show('setattr, %s raises %s' % (where, what), lambda: setattr(own(), name(), 1))
        show('delattr, %s raises %s' % (where, what), lambda: delattr(own(), name()))
        show('object.__setattr__, %s raises %s' % (where, what), lambda: object.__setattr__(own(), name(), 1))
        show('object.__delattr__, %s raises %s' % (where, what), lambda: object.__delattr__(own(), name()))
        show('getattr, %s raises %s' % (where, what), lambda: getattr(own(), name()))
# The key that raises is in the dict, and the name is a plain str.
def with_key_that_raises(make):
    class C: pass
    o = C(); o.__dict__[raises_in_eq(make)] = 'under the key'
    return o
for make in (lambda: KeyError('k'), lambda: ValueError('v'), lambda: AttributeError('a')):
    what = repr(make())
    show('a key in the dict raises %s: setattr' % what, lambda: setattr(with_key_that_raises(make), 'attr', 1))
    show('a key in the dict raises %s: delattr' % what, lambda: delattr(with_key_that_raises(make), 'attr'))
    show('a key in the dict raises %s: getattr' % what, lambda: getattr(with_key_that_raises(make), 'attr'))
    show('a key in the dict raises %s: getattr, default' % what, lambda: getattr(with_key_that_raises(make), 'attr', 'default'))
    show('a key in the dict raises %s: hasattr' % what, lambda: hasattr(with_key_that_raises(make), 'attr'))
    show('a key in the dict raises %s: o.attr' % what, lambda: with_key_that_raises(make).attr)

print('-- 2')
for make in (lambda: AttributeError('a'), lambda: KeyError('k')):
    what = repr(make())
    for kind in (own, own_and_class, own_and_method, own_and_property, with_hook):
        for where, name in (('second hash', lambda: raises_at_hash(2, make)), ('eq', lambda: raises_in_eq(make))):
            def called(value): return value() if callable(value) else value
            label = '%s, %s raises %s' % (kind.__name__, where, what)
            show('getattr: ' + label, lambda: called(getattr(kind(), name())))
            show('getattr, default: ' + label, lambda: called(getattr(kind(), name(), 'default')))
            show('hasattr: ' + label, lambda: hasattr(kind(), name()))
for name in (Plain, Logs):
    show('an empty slot, %s: getattr' % name.__name__, lambda: getattr(empty_slot(), name('attr')))
    show('an empty slot, %s: getattr, default' % name.__name__, lambda: getattr(empty_slot(), name('attr'), 'default'))
    show('an empty slot, %s: hasattr' % name.__name__, lambda: hasattr(empty_slot(), name('attr')))
def raising_property():
    class C:
        @property
        def attr(self): raise AttributeError('from the property')
    return C()
for name in (Plain, Logs):
    show('a property that raises, %s: getattr' % name.__name__, lambda: getattr(raising_property(), name('attr')))
    show('a property that raises, %s: getattr, default' % name.__name__, lambda: getattr(raising_property(), name('attr'), 'default'))
    show('a property that raises, %s: hasattr' % name.__name__, lambda: hasattr(raising_property(), name('attr')))

print('-- 3')
def changing(when):
    class B1: attr = 'of B1'
    class B2: attr = 'of B2'
    class X(B1): pass
    class Name(str):
        def __hash__(self):
            if when == 'hash': X.__bases__ = (B2,)
            return str.__hash__(self)
        def __eq__(self, other):
            if when == 'eq': X.__bases__ = (B2,)
            return str.__eq__(self, other)
    return X, Name('attr')
for when in ('hash', 'eq'):
    def instance():
        X, name = changing(when); return getattr(X(), name), X.__bases__[0].__name__
    def cls():
        X, name = changing(when); return getattr(X, name), X.__bases__[0].__name__
    def has():
        X, name = changing(when); return hasattr(X(), name), X.__bases__[0].__name__
    def sup():
        X, name = changing(when)
        class Y(X): pass
        return getattr(super(Y, Y()), name), X.__bases__[0].__name__
    show('__%s__ changes __bases__: an instance' % when, instance)
    show('__%s__ changes __bases__: the class' % when, cls)
    show('__%s__ changes __bases__: hasattr' % when, has)
    show('__%s__ changes __bases__: super' % when, sup)

print('-- 4')
def changes_class(when, **in_class):
    C = type('C', (), dict(in_class)); New = type('New', (), dict(in_class))
    o = C()
    class Name(str):
        def __hash__(self):
            if when == 'hash': o.__class__ = New
            return str.__hash__(self)
        def __eq__(self, other):
            if when == 'eq': o.__class__ = New
            return str.__eq__(self, other)
    return o, Name('attr')
class Tells:
    def __get__(self, instance, owner): return 'told of %s' % owner.__name__
class TellsData(Tells):
    def __set__(self, instance, value): pass
for when in ('hash', 'eq'):
    def run(operation, **in_class):
        o, name = changes_class(when, **in_class)
        return operation(o, name)
    show('__%s__ changes __class__: getattr, nothing there' % when, lambda: run(getattr))
    show('__%s__ changes __class__: delattr, nothing there' % when, lambda: run(delattr))
    show('__%s__ changes __class__: delattr, of the class' % when, lambda: run(delattr, attr=1))
    show('__%s__ changes __class__: a class method' % when, lambda: run(getattr, attr=classmethod(lambda cls: cls.__name__))())
    show('__%s__ changes __class__: a descriptor' % when, lambda: run(getattr, attr=Tells()))
    show('__%s__ changes __class__: a data descriptor' % when, lambda: run(getattr, attr=TellsData()))
    show('__%s__ changes __class__: a method' % when, lambda: run(getattr, attr=lambda self: type(self).__name__)())

print('-- 5')
def sample():
    class C:
        k = 'of the class'
        def m(self, *args, **keywords): return ('m', args, keywords)
        def other(self, *args): return ('other', args)
    o = C(); o.attr = 1; o.sub = C(); o.sub.attr = 'inner'; return o
class Hook:
    def __getattr__(self, name): return (type(name).__name__, str(name))
class All:
    def __getattribute__(self, name): return (type(name).__name__, str(name))
def called(value): return value() if callable(value) else value
for name in (Logs, Other, Plain):
    n = name.__name__
    show('%s attrgetter: made' % n, lambda: type(operator.attrgetter(name('attr'))).__name__)
    show('%s attrgetter: called' % n, lambda: called(operator.attrgetter(name('attr'))(sample())))
    show('%s attrgetter: of the class' % n, lambda: called(operator.attrgetter(name('k'))(sample())))
    show('%s attrgetter: missing' % n, lambda: called(operator.attrgetter(name('nope'))(sample())))
    show('%s attrgetter: two' % n, lambda: [called(x) for x in operator.attrgetter(name('attr'), name('k'))(sample())])
    show('%s attrgetter: dotted' % n, lambda: operator.attrgetter(name('sub.attr'))(sample()))
    show('%s attrgetter: __getattr__' % n, lambda: operator.attrgetter(name('x'))(Hook()))
    show('%s attrgetter: dotted, __getattr__' % n, lambda: operator.attrgetter(name('x.count'))(Hook())('x'))
    show('%s attrgetter: __getattribute__' % n, lambda: operator.attrgetter(name('x'))(All()))
    show('%s attrgetter: repr' % n, lambda: repr(operator.attrgetter(name('attr'), name('a.b'))))
    show('%s attrgetter: __reduce__' % n, lambda: [(type(x).__name__, str(x)) for x in operator.attrgetter(name('attr'), name('a.b')).__reduce__()[1]])
    show('%s attrgetter: an int' % n, lambda: operator.attrgetter(name('real'))(5))
    show('%s methodcaller: made' % n, lambda: type(operator.methodcaller(name('m'))).__name__)
    show('%s methodcaller: called' % n, lambda: operator.methodcaller(name('m'), 1, x=2)(sample()))
    show('%s methodcaller: missing' % n, lambda: operator.methodcaller(name('nope'))(sample()))
    show('%s methodcaller: of the instance' % n, lambda: operator.methodcaller(name('attr'))(sample()))
    show('%s methodcaller: __getattr__' % n, lambda: operator.methodcaller(name('x'))(Hook()))
    show('%s methodcaller: repr' % n, lambda: repr(operator.methodcaller(name('m'), 1, x=2)))
    show('%s methodcaller: __reduce__' % n, lambda: [(type(x).__name__, str(x)) for x in operator.methodcaller(name('m'), 1).__reduce__()[1]])
    show('%s methodcaller: a class' % n, lambda: operator.methodcaller(name('mro'))(Hook)[0].__name__)
    show('%s methodcaller: a str' % n, lambda: operator.methodcaller(name('upper'))('abc'))

print('-- 6')
class SubLocal(threading.local): k = 'of the class'
for cls in (threading.local, SubLocal):
    for name in (Logs, Other, SaysYes, Plain, str):
        n = '%s, %s' % (cls.__name__, name.__name__)
        def local():
            x = cls(); x.attr = 1; x.other = 'under other'; return x
        show('%s: getattr' % n, lambda: getattr(local(), name('attr')))
        show('%s: getattr, missing' % n, lambda: getattr(local(), name('nope')))
        show('%s: getattr, default' % n, lambda: getattr(local(), name('nope'), 'default'))
        show('%s: getattr __dict__' % n, lambda: sorted(getattr(local(), name('__dict__'))))
        show('%s: getattr __class__' % n, lambda: getattr(getattr(local(), name('__class__')), '__name__', 'no class'))
        show('%s: hasattr' % n, lambda: hasattr(local(), name('attr')))
        show('%s: setattr' % n, lambda: (lambda x: (setattr(x, name('new'), 1), [(type(k).__name__, str(k)) for k in x.__dict__]))(local()))
        show('%s: setattr __dict__' % n, lambda: setattr(local(), name('__dict__'), {}))
        show('%s: delattr' % n, lambda: (lambda x: (delattr(x, name('attr')), sorted(x.__dict__)))(local()))
        show('%s: delattr __dict__' % n, lambda: delattr(local(), name('__dict__')))
        show('%s: delattr, missing' % n, lambda: delattr(local(), name('nope')))
    def with_class_in_dict():
        x = cls(); x.__dict__['__class__'] = 5; x.__dict__['__dict__'] = 6; x.__dict__['k'] = 7
        return getattr(x.__class__, '__name__', x.__class__), sorted(x.__dict__), x.k
    show('%s: __class__, __dict__ and k in the dict' % cls.__name__, with_class_in_dict)

print('-- 7')
class O: pass
keep = O()
class SubContext(decimal.Context): pass
class Meta(type): pass
class WithMeta(metaclass=Meta): pass
class SubModule(types.ModuleType): pass
for label, make in (('a weak proxy', lambda: weakref.proxy(keep)), ('a callable proxy', lambda: weakref.proxy(show)), ('a Context', decimal.Context), ('a SubContext', SubContext), ('a class', lambda: O), ('int', lambda: int),
                    ('a class with a metaclass', lambda: WithMeta), ('a module', lambda: types.ModuleType('m')), ('a SubModule', lambda: SubModule('m')), ('a super', lambda: super(O, keep)),
                    ('a SimpleNamespace', types.SimpleNamespace), ('a function', lambda: (lambda: 1)), ('a partial', lambda: functools.partial(print)), ('an exception', ValueError), ('an object', object), ('an instance', O)):
    x = make()
    show('%s: object.__setattr__' % label, lambda: object.__setattr__(x, 'attr7', 1))
    show('%s: object.__getattribute__' % label, lambda: object.__getattribute__(x, 'attr7'))
    show('%s: object.__delattr__' % label, lambda: object.__delattr__(x, 'attr7'))
    show('%s: object.__delattr__ again' % label, lambda: object.__delattr__(x, 'attr7'))
