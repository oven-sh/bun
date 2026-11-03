# __dict__ and __weakref__: who has them, what the descriptors do for classes with several kinds of bases, and keys that are not str.
import types, warnings, weakref

def t(label, f):
    try:
        print(label, 'ok', f())
    except Exception as e:
        print(label, type(e).__name__, e)

# The sizes of the items decide whether instances of a derived class can be weakly referenced.
for base in (int, tuple, bytes, str, float, list, dict, type, object, frozenset, complex, bytearray):
    cls = type(base)('X', (base,), {}) if base is not type else type('X', (type,), {})
    obj = cls('Y', (), {}) if base is type else cls()
    try:
        weakref.ref(obj); weak = True
    except TypeError as e:
        weak = str(e)
    print(base.__name__, base.__itemsize__, cls.__itemsize__, '__weakref__' in vars(cls), '__dict__' in vars(cls), cls.__weakrefoffset__ != 0, cls.__dictoffset__ != 0, weak)

def slots(base, *names):
    return sorted(k for k in vars(type('X', (base,), {'__slots__': names})) if not k.startswith('__') or k in ('__dict__', '__weakref__'))
for base in (int, tuple, bytes, str, float, list, object):
    t(base.__name__ + ' a', lambda: slots(base, 'a'))
    t(base.__name__ + ' __weakref__', lambda: slots(base, '__weakref__'))
    t(base.__name__ + ' __dict__', lambda: slots(base, '__dict__'))
    t(base.__name__ + ' ()', lambda: slots(base))
t('twice', lambda: slots(object, '__dict__', '__dict__'))
t('twice', lambda: slots(object, '__weakref__', '__weakref__'))
t('has one', lambda: slots(type('B', (), {}), '__dict__'))
t('has one', lambda: slots(type('B', (), {}), '__weakref__'))
t('not an identifier', lambda: slots(object, 'a b'))
t('not a str', lambda: slots(object, 1))
t('conflict', lambda: type('X', (), {'__slots__': ('a',), 'a': 1}))

# __classcell__ and __slots__.
class WithCell:
    __slots__ = ('__classcell__',)
    def f(self):
        return __class__
print(WithCell().f().__name__, sorted(k for k in vars(WithCell) if 'cell' in k))

# The __dict__ of an instance of a class derived from a type that has a __dict__ descriptor of its own.
class Meta(type): pass
class C(metaclass=Meta): pass
print(type(C.__dict__).__name__, type(Meta.__dict__['__dict__']).__name__ if '__dict__' in vars(Meta) else None)
class Mod(types.ModuleType): pass
m = Mod('m'); m.x = 1
print(sorted(k for k in m.__dict__ if not k.startswith('__')), '__dict__' in vars(Mod))
def set_dict(obj, value):
    obj.__dict__ = value
    return obj.__dict__
t('module', lambda: set_dict(m, {}))
t('class', lambda: set_dict(C, {}))
class F(type(lambda: 0).__mro__[0].__mro__[-1]): pass
class Plain: pass
p = Plain(); p.a = 1
t('plain', lambda: set_dict(p, {'b': 2}))
t('plain', lambda: set_dict(p, 1))
t('plain', lambda: set_dict(p, types.MappingProxyType({})))
def del_dict(obj):
    del obj.__dict__
    return obj.__dict__
t('del', lambda: del_dict(p))
class E(Exception): pass
e = E(); e.a = 1
t('exception', lambda: set_dict(e, {'b': 2}))
t('exception', lambda: del_dict(e))
def f(): pass
f.a = 1
t('function', lambda: set_dict(f, {'b': 2}))
t('function', lambda: del_dict(f))
t('function', lambda: set_dict(f, 1))
descriptor = Plain.__dict__['__dict__']
t('foreign', lambda: descriptor.__get__(1))
t('foreign', lambda: descriptor.__get__(e))
t('foreign', lambda: descriptor.__get__(E()))
t('foreign', lambda: descriptor.__set__(1, {}))
print(descriptor.__name__, descriptor.__objclass__.__name__, descriptor.__doc__, Plain.__dict__['__weakref__'].__doc__)

# Keys that are not str.
class Key:
    def __init__(self, text): self.text = text
    def __hash__(self): return hash(self.text)
    def __eq__(self, other):
        asked.append(other)
        return self.text == other
asked = []
def was_asked():
    # How often is a matter of what is remembered of earlier lookups.
    result = sorted(set(asked))
    asked.clear()
    return result
with warnings.catch_warnings(record=True) as caught:
    warnings.simplefilter('always')
    K = type('K', (), {1: 2, 'a': 3})
    print([(w.category.__name__, str(w.message)) for w in caught])
print(sorted(map(repr, vars(K))) [:3])
with warnings.catch_warnings(record=True) as caught:
    warnings.simplefilter('always')
    K2 = type('K2', (), {Key('attr'): 'found'})
    print([(w.category.__name__, str(w.message)) for w in caught])
t('class attribute', lambda: (K2.attr, was_asked()))
t('class attribute', lambda: K2().attr)
asked.clear()
o = Plain()
o.__dict__[Key('attr')] = 'in the instance'
t('instance attribute', lambda: (o.attr, was_asked()))
t('missing', lambda: o.other)
def set_attr():
    o.attr = 'replaced'
    return [(type(k).__name__, v) for k, v in o.__dict__.items()], was_asked()
t('set', set_attr)
def del_attr():
    del o.attr
    return o.__dict__, was_asked()
t('del', del_attr)
class Bad:
    def __hash__(self): return hash('attr')
    def __eq__(self, other): raise RuntimeError('compared')
o2 = Plain(); o2.__dict__[Bad()] = 1
t('raises', lambda: o2.attr)
t('raises', lambda: getattr(o2, 'attr', 'default'))
t('raises', lambda: hasattr(o2, 'attr'))
t('raises', lambda: setattr(o2, 'attr', 1))
