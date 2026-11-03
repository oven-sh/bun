# __dict__ and __weakref__: who has them, what the descriptors do for classes with several kinds of bases, and keys that are not str.
try: import types, warnings, weakref
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import types, warnings, weakref')

try:
    def t(label, f):
        try:
            print(label, 'ok', f())
        except Exception as e:
            print(label, type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(label, f):')

# The sizes of the items decide whether instances of a derived class can be weakly referenced.
try:
    for base in (int, tuple, bytes, str, float, list, dict, type, object, frozenset, complex, bytearray):
        try: cls = type(base)('X', (base,), {}) if base is not type else type('X', (type,), {})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: cls = type(base)('X', (base,), {}) if base is not type else type('X',...")
        try: obj = cls('Y', (), {}) if base is type else cls()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: obj = cls('Y', (), {}) if base is type else cls()")
        try:
            weakref.ref(obj)
            weak = True
        except TypeError as e:
            weak = str(e)
        try: print('base.__name__ [' + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + '] =>', base.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: base.__name__')
        try: print('base.__itemsize__ [' + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + '] =>', base.__itemsize__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: base.__itemsize__')
        try: print('cls.__itemsize__ [' + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + '] =>', cls.__itemsize__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cls.__itemsize__')
        try: print("'__weakref__' in vars(cls) [" + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + '] =>', '__weakref__' in vars(cls))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '__weakref__' in vars(cls)")
        try: print("'__dict__' in vars(cls) [" + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + '] =>', '__dict__' in vars(cls))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '__dict__' in vars(cls)")
        try: print('cls.__weakrefoffset__ != 0 [' + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + '] =>', cls.__weakrefoffset__ != 0)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cls.__weakrefoffset__ != 0')
        try: print('cls.__dictoffset__ != 0 [' + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + '] =>', cls.__dictoffset__ != 0)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cls.__dictoffset__ != 0')
        try: print('weak [' + 'base=' + (repr(base) if type(base) in (str, int, float, bytes, bool, type(None)) or (type(base) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in base)) else base.__name__ if type(base) is type else type(base).__name__) + '] =>', weak)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: weak')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for base in (int, tuple, bytes, str, float, list, dict, type, object,...')

try:
    def slots(base, *names):
        return sorted(k for k in vars(type('X', (base,), {'__slots__': names})) if not k.startswith('__') or k in ('__dict__', '__weakref__'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def slots(base, *names):')
try:
    for base in (int, tuple, bytes, str, float, list, object):
        try: t(base.__name__ + ' a', lambda: slots(base, 'a'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t(base.__name__ + ' a', lambda: slots(base, 'a'))")
        try: t(base.__name__ + ' __weakref__', lambda: slots(base, '__weakref__'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t(base.__name__ + ' __weakref__', lambda: slots(base, '__weakref__'))")
        try: t(base.__name__ + ' __dict__', lambda: slots(base, '__dict__'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t(base.__name__ + ' __dict__', lambda: slots(base, '__dict__'))")
        try: t(base.__name__ + ' ()', lambda: slots(base))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t(base.__name__ + ' ()', lambda: slots(base))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for base in (int, tuple, bytes, str, float, list, object):')
try: t('twice', lambda: slots(object, '__dict__', '__dict__'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('twice', lambda: slots(object, '__dict__', '__dict__'))")
try: t('twice', lambda: slots(object, '__weakref__', '__weakref__'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('twice', lambda: slots(object, '__weakref__', '__weakref__'))")
try: t('has one', lambda: slots(type('B', (), {}), '__dict__'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('has one', lambda: slots(type('B', (), {}), '__dict__'))")
try: t('has one', lambda: slots(type('B', (), {}), '__weakref__'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('has one', lambda: slots(type('B', (), {}), '__weakref__'))")
try: t('not an identifier', lambda: slots(object, 'a b'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('not an identifier', lambda: slots(object, 'a b'))")
try: t('not a str', lambda: slots(object, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('not a str', lambda: slots(object, 1))")
try: t('conflict', lambda: type('X', (), {'__slots__': ('a',), 'a': 1}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('conflict', lambda: type('X', (), {'__slots__': ('a',), 'a': 1}))")

# __classcell__ and __slots__.
try:
    class WithCell:
        __slots__ = ('__classcell__',)
        def f(self):
            return __class__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithCell:')
try: print('WithCell().f().__name__ =>', WithCell().f().__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: WithCell().f().__name__')
try: print("sorted(k for k in vars(WithCell) if 'cell' in k) =>", sorted(k for k in vars(WithCell) if 'cell' in k))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: sorted(k for k in vars(WithCell) if 'cell' in k)")

# The __dict__ of an instance of a class derived from a type that has a __dict__ descriptor of its own.
try:
    class Meta(type): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Meta(type): pass')
try:
    class C(metaclass=Meta): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C(metaclass=Meta): pass')
try: print('type(C.__dict__).__name__ =>', type(C.__dict__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(C.__dict__).__name__')
try: print("type(Meta.__dict__['__dict__']).__name__ if '__dict__' in vars(Meta) ... =>", type(Meta.__dict__['__dict__']).__name__ if '__dict__' in vars(Meta) else None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: type(Meta.__dict__['__dict__']).__name__ if '__dict__' in vars(Meta) ...")
try:
    class Mod(types.ModuleType): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Mod(types.ModuleType): pass')
try: m = Mod('m')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: m = Mod('m')")
try: m.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.x = 1')
try: print("sorted(k for k in m.__dict__ if not k.startswith('__')) =>", sorted(k for k in m.__dict__ if not k.startswith('__')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: sorted(k for k in m.__dict__ if not k.startswith('__'))")
try: print("'__dict__' in vars(Mod) =>", '__dict__' in vars(Mod))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '__dict__' in vars(Mod)")
try:
    def set_dict(obj, value):
        obj.__dict__ = value
        return obj.__dict__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def set_dict(obj, value):')
try: t('module', lambda: set_dict(m, {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('module', lambda: set_dict(m, {}))")
try: t('class', lambda: set_dict(C, {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('class', lambda: set_dict(C, {}))")
try:
    class F(type(lambda: 0).__mro__[0].__mro__[-1]): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class F(type(lambda: 0).__mro__[0].__mro__[-1]): pass')
try:
    class Plain: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Plain: pass')
try: p = Plain()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p = Plain()')
try: p.a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.a = 1')
try: t('plain', lambda: set_dict(p, {'b': 2}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('plain', lambda: set_dict(p, {'b': 2}))")
try: t('plain', lambda: set_dict(p, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('plain', lambda: set_dict(p, 1))")
try: t('plain', lambda: set_dict(p, types.MappingProxyType({})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('plain', lambda: set_dict(p, types.MappingProxyType({})))")
try:
    def del_dict(obj):
        del obj.__dict__
        return obj.__dict__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def del_dict(obj):')
try: t('del', lambda: del_dict(p))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('del', lambda: del_dict(p))")
try:
    class E(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(Exception): pass')
try: e = E()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = E()')
try: e.a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.a = 1')
try: t('exception', lambda: set_dict(e, {'b': 2}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('exception', lambda: set_dict(e, {'b': 2}))")
try: t('exception', lambda: del_dict(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('exception', lambda: del_dict(e))")
try:
    def f(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f(): pass')
try: f.a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.a = 1')
try: t('function', lambda: set_dict(f, {'b': 2}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('function', lambda: set_dict(f, {'b': 2}))")
try: t('function', lambda: del_dict(f))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('function', lambda: del_dict(f))")
try: t('function', lambda: set_dict(f, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('function', lambda: set_dict(f, 1))")
try: descriptor = Plain.__dict__['__dict__']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: descriptor = Plain.__dict__['__dict__']")
try: t('foreign', lambda: descriptor.__get__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('foreign', lambda: descriptor.__get__(1))")
try: t('foreign', lambda: descriptor.__get__(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('foreign', lambda: descriptor.__get__(e))")
try: t('foreign', lambda: descriptor.__get__(E()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('foreign', lambda: descriptor.__get__(E()))")
try: t('foreign', lambda: descriptor.__set__(1, {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('foreign', lambda: descriptor.__set__(1, {}))")
try: print('descriptor.__name__ =>', descriptor.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: descriptor.__name__')
try: print('descriptor.__objclass__.__name__ =>', descriptor.__objclass__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: descriptor.__objclass__.__name__')
try: print('descriptor.__doc__ =>', descriptor.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: descriptor.__doc__')
try: print("Plain.__dict__['__weakref__'].__doc__ =>", Plain.__dict__['__weakref__'].__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Plain.__dict__['__weakref__'].__doc__")

# Keys that are not str.
try:
    class Key:
        def __init__(self, text): self.text = text
        def __hash__(self): return hash(self.text)
        def __eq__(self, other):
            asked.append(other)
            return self.text == other
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Key:')
try: asked = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: asked = []')
try:
    def was_asked():
        # How often is a matter of what is remembered of earlier lookups.
        result = sorted(set(asked))
        asked.clear()
        return result
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def was_asked():')
try:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        K = type('K', (), {1: 2, 'a': 3})
        print([(w.category.__name__, str(w.message)) for w in caught])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with warnings.catch_warnings(record=True) as caught:')
try: print(sorted(map(repr, vars(K))) [:3])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(map(repr, vars(K))) [:3]')
try:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        K2 = type('K2', (), {Key('attr'): 'found'})
        print([(w.category.__name__, str(w.message)) for w in caught])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with warnings.catch_warnings(record=True) as caught:')
try: t('class attribute', lambda: (K2.attr, was_asked()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('class attribute', lambda: (K2.attr, was_asked()))")
try: t('class attribute', lambda: K2().attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('class attribute', lambda: K2().attr)")
try: asked.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: asked.clear()')
try: o = Plain()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Plain()')
try: o.__dict__[Key('attr')] = 'in the instance'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: o.__dict__[Key('attr')] = 'in the instance'")
try: t('instance attribute', lambda: (o.attr, was_asked()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('instance attribute', lambda: (o.attr, was_asked()))")
try: t('missing', lambda: o.other)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('missing', lambda: o.other)")
try:
    def set_attr():
        o.attr = 'replaced'
        return [(type(k).__name__, v) for k, v in o.__dict__.items()], was_asked()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def set_attr():')
try: t('set', set_attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('set', set_attr)")
try:
    def del_attr():
        del o.attr
        return o.__dict__, was_asked()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def del_attr():')
try: t('del', del_attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('del', del_attr)")
try:
    class Bad:
        def __hash__(self): return hash('attr')
        def __eq__(self, other): raise RuntimeError('compared')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Bad:')
try: o2 = Plain()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o2 = Plain()')
try: o2.__dict__[Bad()] = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o2.__dict__[Bad()] = 1')
try: t('raises', lambda: o2.attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('raises', lambda: o2.attr)")
try: t('raises', lambda: getattr(o2, 'attr', 'default'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('raises', lambda: getattr(o2, 'attr', 'default'))")
try: t('raises', lambda: hasattr(o2, 'attr'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('raises', lambda: hasattr(o2, 'attr'))")
try: t('raises', lambda: setattr(o2, 'attr', 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('raises', lambda: setattr(o2, 'attr', 1))")
