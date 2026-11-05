# getattr(), hasattr(), setattr(), delattr() and the __getattribute__, __setattr__, __delattr__ of object, type and module, given a name that is an instance of a class derived
# from str. Such a name is looked up as a dict looks up any key: in the dicts of the classes, with one hash for all of them, and what it raises there is lost; then in the dict of the
# object, with another. Here: every call of its __hash__ and __eq__, in order, the result, what the dict holds afterwards, and what an AttributeError has as its name.
# (How often a key is asked also depends on the slots that a search comes by, and so on the hash of the text: in children with a PYTHONHASHSEED. Under one seed in three a name that says
# no is asked once more or once less in the dict of an instance than by CPython, whose instances share a table of 64 slots: these three seeds are not among them.)
# One line for each kind of object and of name: how many rows, and a digest of them. To see the rows: PYTHONHASHSEED=0 python3 attr_names_calls.py rows plain N (or: rows all)
import hashlib, os, subprocess, sys, types, weakref

log = []
class S(str): pass
class N(str):
    def __hash__(self): log.append('h'); return str.__hash__(self)
    def __eq__(self, other): log.append('e:%s' % type(other).__name__); return str.__eq__(self, other)
class No(str):
    def __hash__(self): log.append('h'); return str.__hash__(self)
    def __eq__(self, other): log.append('e:%s' % type(other).__name__); return False
class Unsure(str):
    __hash__ = str.__hash__
    def __eq__(self, other): log.append('e:%s' % type(other).__name__); return NotImplemented
class Elsewhere(str):
    def __hash__(self): log.append('h'); return hash('other')
    def __eq__(self, other): log.append('e:%s' % type(other).__name__); return True
class Fold(str):
    def __hash__(self): log.append('h'); return hash(str(self).lower())
    def __eq__(self, other): log.append('e:%s' % type(other).__name__); return str(self).lower() == str(other).lower()
class HashRaises(str):
    def __hash__(self): log.append('h'); raise ZeroDivisionError('in __hash__')
class EqRaises(str):
    def __hash__(self): log.append('h'); return str.__hash__(self)
    def __eq__(self, other): log.append('e:%s' % type(other).__name__); raise ZeroDivisionError('in __eq__')
class SecondHashRaises(str):
    def __hash__(self):
        log.append('h')
        if log.count('h') == 2: raise ZeroDivisionError('in the second __hash__')
        return str.__hash__(self)
class NoHash(str):
    __hash__ = None
KINDS = (S, N, No, Unsure, Elsewhere, Fold, HashRaises, EqRaises, SecondHashRaises, NoHash)

# Each object is of a class of its own, made anew for each row.
def plain():
    class C: pass
    o = C(); o.m = 'of the instance'; o.other = 'other'; return o
def bare():
    class C: pass
    return C()
def with_class_attribute():
    class B: m = 'of the base'
    class C(B): pass
    return C()
def both():
    class C: m = 'of the class'
    o = C(); o.m = 'of the instance'; return o
def with_property():
    class C:
        @property
        def m(self): return 'property'
        @m.setter
        def m(self, value): log.append('set')
        @m.deleter
        def m(self): log.append('deleted')
    return C()
def read_only():
    class C:
        @property
        def m(self): return 'property'
    return C()
def with_slots():
    class C: __slots__ = ('m', 'other')
    o = C(); o.m = 'slot'; return o
def with_method():
    class C:
        def m(self): pass
    return C()
def with_descriptor():
    class D:
        def __get__(self, o, t): return 'from __get__'
    class C: m = D()
    return C()
def with_getattr():
    class C:
        def __getattr__(self, name): return ('__getattr__', type(name).__name__, str(name))
    return C()
def with_hooks():
    class C:
        def __getattribute__(self, name): return ('__getattribute__', type(name).__name__, str(name))
        def __setattr__(self, name, value): log.append('__setattr__:%s' % type(name).__name__)
        def __delattr__(self, name): log.append('__delattr__:%s' % type(name).__name__)
    return C()
def a_class():
    class M(type): other = 'of the metaclass'
    class C(metaclass=M): m = 'of the class itself'
    return C
def a_module():
    o = types.ModuleType('mod'); o.m = 'of the module'; return o
def a_module_with_getattr():
    o = types.ModuleType('mod'); o.__getattr__ = lambda name: ('module __getattr__', type(name).__name__, str(name)); return o
def a_function():
    def o(): pass
    o.m = 'of the function'; return o
def a_bare_function():
    def o(): pass
    return o
def a_namespace(): return types.SimpleNamespace(m='of the namespace')
def an_exception(): return ValueError()
def an_int(): return 5
def an_object(): return object()
def of_a_dict_class():
    class C(dict): pass
    o = C(); o.m = 'of the instance'; return o
kept = []
def a_proxy():
    del kept[:]; kept.append(plain()); return weakref.proxy(kept[0])
def a_bound_method():
    class C:
        def f(self): pass
    C.f.m = 'of the function'
    return C().f
def a_super():
    class A: m = 'of A'; other = 'other, of A'
    class B(A): m = 'of B'
    class C(B): m = 'of C'
    return super(C, C())
def a_super_of_a_class():
    class A: m = 'of A'; other = classmethod(lambda cls: 'other, of A')
    class B(A): pass
    return super(B, B)
MAKERS = (plain, bare, with_class_attribute, both, with_property, read_only, with_slots, with_method, with_descriptor, with_getattr, with_hooks, a_class, a_module, a_module_with_getattr, a_function,
          a_bare_function, a_namespace, an_exception, an_int, an_object, of_a_dict_class, a_proxy, a_bound_method, a_super, a_super_of_a_class)

def shown(value):
    return 'a method' if isinstance(value, types.MethodType) else 'a function' if isinstance(value, types.FunctionType) else 'a dict' if isinstance(value, (dict, types.MappingProxyType)) else \
        'a class' if isinstance(value, type) else value
def names_of(o):
    try: d = object.__getattribute__(o, '__dict__')
    except AttributeError: return None
    return [(type(k).__name__, str(k)) for k in list(d) if not str(k).startswith('__')]
group = []
def end_of_group(*name):
    if sys.argv[2:] in (list(name), ['all']): print('\n'.join(group))
    elif not sys.argv[2:]: print(*name, len(group), 'rows', hashlib.md5('\n'.join(group).encode()).hexdigest()[:12])
    del group[:]
def row(label, o, f):
    del log[:]
    try: r = shown(f())
    except BaseException as e: r = '%s: %s (name: %s)' % (type(e).__name__, e, type(getattr(e, 'name', None)).__name__)
    calls = ' '.join(log)
    group.append('%s | %s | %s | %s' % (label, calls, r, names_of(o)))

def rows():
    for make in MAKERS:
        for kind in KINDS:
            for text in ('m', 'M', 'other', 'absent', '__class__', '__dict__'):
                if text == 'M' and kind is not Fold: continue
                label = '%s %s %s' % (make.__name__, kind.__name__, text)
                o = make(); row(label + ' getattr', o, lambda: getattr(o, kind(text)))
                if text in ('__class__', '__dict__'): continue
                o = make(); row(label + ' getattr with a default', o, lambda: getattr(o, kind(text), 'default'))
                o = make(); row(label + ' hasattr', o, lambda: hasattr(o, kind(text)))
                o = make(); row(label + ' object.__getattribute__', o, lambda: object.__getattribute__(o, kind(text)))
                o = make(); row(label + ' setattr', o, lambda: setattr(o, kind(text), 'new'))
                o = make(); row(label + ' delattr', o, lambda: delattr(o, kind(text)))
                if make is not a_proxy: # (Whether object's may be applied to one is another matter.)
                    o = make(); row(label + ' object.__setattr__', o, lambda: object.__setattr__(o, kind(text), 'new'))
                    o = make(); row(label + ' object.__delattr__', o, lambda: object.__delattr__(o, kind(text)))
                if text != 'absent': continue
                # What has been stored under such a name, looked for by the text and by another such name.
                def then(f):
                    setattr(o, kind(text), 'new'); log.append('|'); return f()
                o = make(); row(label + ' setattr, then o.absent', o, lambda: then(lambda: o.absent))
                o = make(); row(label + ' setattr, then getattr by the text', o, lambda: then(lambda: getattr(o, text)))
                o = make(); row(label + ' setattr, then getattr by such a name', o, lambda: then(lambda: getattr(o, kind(text))))
                o = make(); row(label + ' setattr twice', o, lambda: then(lambda: setattr(o, kind(text), 'newer')))
                o = make(); row(label + ' setattr, then o.absent = 1', o, lambda: then(lambda: setattr(o, text, 1)))
                o = make(); row(label + ' setattr, then del o.absent', o, lambda: then(lambda: delattr(o, text)))
                o = make(); row(label + ' setattr, then delattr by such a name', o, lambda: then(lambda: delattr(o, kind(text))))
            end_of_group(make.__name__, kind.__name__)
    for kind in KINDS:
        for text in ('m', 'other', 'absent'):
            label = 'type %s %s' % (kind.__name__, text)
            o = a_class(); row(label + ' type.__getattribute__', o, lambda: type.__getattribute__(o, kind(text)))
            o = a_class(); row(label + ' type.__setattr__', o, lambda: type.__setattr__(o, kind(text), 'new'))
            o = a_class(); row(label + ' type.__delattr__', o, lambda: type.__delattr__(o, kind(text)))
            o = a_module(); row(label + ' module.__getattribute__', o, lambda: types.ModuleType.__getattribute__(o, kind(text)))
        end_of_group('type', kind.__name__)
    for bad in (1, None, b'm', ('m',), 1.5):
        for label, f in (('getattr', lambda o: getattr(o, bad)), ('getattr with a default', lambda o: getattr(o, bad, 0)), ('hasattr', lambda o: hasattr(o, bad)), ('setattr', lambda o: setattr(o, bad, 0)),
                         ('delattr', lambda o: delattr(o, bad)), ('object.__getattribute__', lambda o: object.__getattribute__(o, bad)), ('object.__setattr__', lambda o: object.__setattr__(o, bad, 0)),
                         ('object.__delattr__', lambda o: object.__delattr__(o, bad))):
            for make in (plain, a_class, a_module, with_hooks, with_getattr):
                o = make(); row('%s %r %s' % (make.__name__, bad, label), o, lambda: f(o))
        end_of_group('no str', repr(bad))

if sys.argv[1:2] == ['rows']:
    rows()
    sys.exit()
for hashseed in ('3', '7', '12345'):
    child = subprocess.run([sys.executable, __file__, 'rows'], env=dict(os.environ, PYTHONHASHSEED=hashseed), stdout=subprocess.PIPE, text=True)
    print('PYTHONHASHSEED', hashseed, 'status', child.returncode)
    print(child.stdout, end='')
