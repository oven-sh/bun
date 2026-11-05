# Keyword names that are instances of classes derived from str: f(**{K('a'): 1}). Who gets the key itself, who asks it what, and how often: every call of its __hash__ and __eq__ after the
# dict was made, the result, and the keys that are kept.
# A function written in Python asks the key whether it equals each parameter; **kwargs gets the key. What is given names and values in CPython stores them one by one (a hash for each):
# dict(), the class statement, a call of type itself. What is given the dict of the keywords copies or merges it with the hashes it has: update(), classes derived from dict,
# SimpleNamespace, partial, str.format(). lru_cache's key has the keys; ast nodes look the key up among their fields.
# Not here: functions written in C that look their parameters up in the dict of the keywords (int, str, deque, zip ...), which go by the text in this implementation.
# How often a key that says no is asked depends on the slots that a search comes by, and so on the hash of the text: in children with a PYTHONHASHSEED.
import ast, collections, copy, dataclasses, datetime, functools, hashlib, operator, os, subprocess, sys, threading, types, warnings
warnings.simplefilter('ignore')
LOG = []
class S(str): pass
class L(str):
    def __hash__(s): LOG.append('hash'); return str.__hash__(s)
    def __eq__(s, o): LOG.append('eq(%s)' % type(o).__name__); return str.__eq__(s, o)
class No(str):
    def __hash__(s): LOG.append('hash'); return str.__hash__(s)
    def __eq__(s, o): LOG.append('eq(%s)' % type(o).__name__); return False
class Else(str):
    "says that it is 'other'"
    def __hash__(s): LOG.append('hash'); return hash('other')
    def __eq__(s, o): LOG.append('eq(%s)' % type(o).__name__); return str(o) == 'other'
KINDS = (S, L, No, Else)
def keys_of(d): return [(type(k).__name__, str(k)) for k in d]
def show(label, f):
    try: r = f()
    except BaseException as e: r = '!%s: %s' % (type(e).__name__, str(e)[:90])
    print(label, '|', r, '|', ' '.join(LOG))
def f_kw(**kw): return keys_of(kw)
def f_a(a=None): return ('a', a)
def f_a_kw(a=None, **kw): return ('a', a, keys_of(kw))
def f_other(other=None, **kw): return ('other', other, keys_of(kw))
class Init:
    def __init__(self, **kw): self.kw = keys_of(kw)
class Sub:
    def __init_subclass__(cls, **kw): cls.kw = keys_of(kw)
class Meta(type):
    def __new__(m, name, bases, ns, **kw): c = super().__new__(m, name, bases, ns); c.kw = keys_of(kw); return c
    def __init__(c, name, bases, ns, **kw): pass
    @classmethod
    def __prepare__(m, name, bases, **kw): LOG.append('prepare %r' % keys_of(kw)); return {}
@functools.lru_cache(maxsize=None)
def cached(**kw): return keys_of(kw)
@functools.lru_cache(maxsize=None, typed=True)
def cached_typed(**kw): return keys_of(kw)
@functools.cache
def cached_a(a=None): return a
P = collections.namedtuple('P', 'a b')
class O:
    def m(self, **kw): return keys_of(kw)
def class_statement(m):
    class X(Sub, **m): pass
    return X.kw
def class_statement_meta(m):
    class X(metaclass=Meta, **m): pass
    return X.kw
def class_statement_metaclass_key(K):
    class X(**{K('metaclass'): Meta}): pass
    return type(X).__name__, X.kw
CONSUMERS = [
 ('f(**kw)', 'a', lambda m: f_kw(**m)), ('f(a)', 'a', lambda m: f_a(**m)), ('f(a, **kw)', 'a', lambda m: f_a_kw(**m)), ('f(a, **kw), b', 'b', lambda m: f_a_kw(**m)), ('f(other, **kw)', 'a', lambda m: f_other(**m)),
 ('C(**kw)', 'a', lambda m: Init(**m).kw), ('o.m(**kw)', 'a', lambda m: O().m(**m)),
 ('dict(**m)', 'a', lambda m: keys_of(dict(**m))), ('d.update(**m)', 'a', lambda m: (lambda d: (d.update(**m), keys_of(d))[1])({})), ("{'a': 0}.update(**m)", 'a', lambda m: (lambda d: (d.update(**m), keys_of(d))[1])({'a': 0})),
 ('OrderedDict(**m)', 'a', lambda m: keys_of(collections.OrderedDict(**m))), ('OrderedDict().update(**m)', 'a', lambda m: (lambda d: (d.update(**m), keys_of(d))[1])(collections.OrderedDict())),
 ('Counter(**m)', 'a', lambda m: keys_of(collections.Counter(**m))), ('defaultdict(None, **m)', 'a', lambda m: keys_of(collections.defaultdict(None, **m))), ('UserDict(**m)', 'a', lambda m: keys_of(collections.UserDict(**m))),
 ('SimpleNamespace(**m)', 'a', lambda m: keys_of(vars(types.SimpleNamespace(**m)))), ('SimpleNamespace repr', 'a', lambda m: repr(types.SimpleNamespace(**m))), ('SimpleNamespace .a', 'a', lambda m: types.SimpleNamespace(**m).a),
 ('copy.replace(ns, **m)', 'a', lambda m: keys_of(vars(copy.replace(types.SimpleNamespace(a=0), **m)))),
 ('partial(f, **m).keywords', 'a', lambda m: keys_of(functools.partial(f_kw, **m).keywords)), ('partial(f, **m)()', 'a', lambda m: functools.partial(f_kw, **m)()), ('partial(f)(**m)', 'a', lambda m: functools.partial(f_kw)(**m)),
 ('partial(f, a=0)(**m)', 'a', lambda m: functools.partial(f_kw, a=0)(**m)), ('partial(f, **m)(a=0)', 'a', lambda m: functools.partial(f_kw, **m)(a=0)), ('partial(f_a, **m)()', 'a', lambda m: functools.partial(f_a, **m)()),
 ('partial(partial(f, **m), **m)', 'a', lambda m: keys_of(functools.partial(functools.partial(f_kw, **m), **m).keywords)), ('partial repr', 'a', lambda m: repr(functools.partial(print, **m))),
 ('partialmethod', 'a', lambda m: type('T', (), {'m': functools.partialmethod(lambda self, **kw: keys_of(kw), **m)})().m()),
 ('lru_cache', 'a', lambda m: (cached(**m), cached(**m), cached.cache_info()[:2])), ('lru_cache, then plain', 'a', lambda m: (cached(**m), cached(a=1), cached.cache_info()[:2])), ('lru_cache typed', 'a', lambda m: (cached_typed(**m), cached_typed(**m), cached_typed.cache_info()[:2])),
 ('cache f(a)', 'a', lambda m: (cached_a(**m), cached_a(**m), cached_a.cache_info()[:2])),
 ('str.format', 'a', lambda m: '{a}'.format(**m)), ('str.format other', 'a', lambda m: '{other}'.format(**m)), ('format_map', 'a', lambda m: '{a}'.format_map(m)),
 ('type(n, b, d, **m)', 'a', lambda m: type('X', (Sub,), {}, **m).kw), ('class X(Sub, **m)', 'a', class_statement), ('class X(metaclass=Meta, **m)', 'a', class_statement_meta), ('Meta(n, b, d, **m)', 'a', lambda m: Meta('X', (), {}, **m).kw),
 ('types.new_class', 'a', lambda m: types.new_class('X', (Sub,), m).kw),
 ('ast.Name(**m)', 'id', lambda m: keys_of(vars(ast.Name(**m)))), ('ast.Name(**m).id', 'id', lambda m: ast.Name(**m).id), ('ast.Name(**m), unknown', 'foo', lambda m: keys_of(vars(ast.Name(**m)))), ('ast.Name dump', 'id', lambda m: ast.dump(ast.Name(**m))),
 ('ast.Name(**m), lineno', 'lineno', lambda m: keys_of(vars(ast.Name('x', **m)))), ("ast.Name('x', **m), twice", 'id', lambda m: keys_of(vars(ast.Name('x', **m)))),
 ('namedtuple(**m)', 'a', lambda m: P(b=2, **m)), ('_replace(**m)', 'a', lambda m: P(1, 2)._replace(**m)), ('methodcaller', 'a', lambda m: operator.methodcaller('m', **m)(O())), ('methodcaller repr', 'a', lambda m: repr(operator.methodcaller('m', **m))),
 ('sorted', 'reverse', lambda m: sorted([1, 2], **m)), ('list.sort', 'reverse', lambda m: (lambda l: (l.sort(**m), l)[1])([1, 2])), ('print', 'end', lambda m: print('', **{k: '' for k in m})),
 ('max', 'default', lambda m: max([], **m)), ('min key', 'key', lambda m: min([1, 2], **{k: None for k in m})), ('enumerate', 'start', lambda m: list(enumerate('a', **m))), ('sum', 'start', lambda m: sum([1], **m)),
 ('split', 'maxsplit', lambda m: 'a b c'.split(**m)), ('round', 'ndigits', lambda m: round(1.26, **m)), ('pow', 'mod', lambda m: pow(2, 3, **{k: 5 for k in m})),
 ('encode', 'errors', lambda m: 'x'.encode(**{k: 'strict' for k in m})),

 ('to_bytes', 'length', lambda m: (1).to_bytes(**m)), ('date.replace', 'year', lambda m: datetime.date(2000, 1, 1).replace(**m)), ('code.replace', 'co_name', lambda m: f_a.__code__.replace(**{k: 'x' for k in m}).co_name),
 ('range', 'a', lambda m: range(**m)), ('len', 'a', lambda m: len(**m)),
 ('object', 'a', lambda m: object(**m)), ('local(**m)', 'a', lambda m: type('T', (threading.local,), {'__init__': lambda self, **kw: setattr(self, 'kw', keys_of(kw))})(**m).kw),
 ('compile', 'optimize', lambda m: compile('1', 'f', 'eval', **m).co_name), ('open', 'mode', lambda m: open(sys.executable, **{k: 'rb' for k in m}).close()), ('memoryview.cast', 'format', lambda m: memoryview(b'ab').cast(**{k: 'B' for k in m}).format),
 ('a dataclass', 'a', lambda m: dataclasses.make_dataclass('D', ['a'])(**m).a), ('Thread', 'name', lambda m: threading.Thread(**{k: 'n' for k in m}).name), ('super().__init__', 'a', lambda m: type('T', (Init,), {'__init__': lambda self, **kw: Init.__init__(self, **kw)})(**m).kw),
 ('exec', 'globals', lambda m: exec('x = 1', **{k: {} for k in m})), ('frozenset', 'a', lambda m: frozenset(**m)), ('slice', 'a', lambda m: slice(1, **m)), ('BaseException', 'a', lambda m: BaseException(**m)), ('staticmethod call', 'a', lambda m: staticmethod(f_kw)(**m)),
 ('bound method of a builtin', 'a', lambda m: {}.get(**m)), ('__call__', 'a', lambda m: type('T', (), {'__call__': lambda self, **kw: keys_of(kw)})()(**m)), ('f.__call__', 'a', lambda m: f_kw.__call__(**m)), ('type.__call__', 'a', lambda m: type.__call__(Init, **m).kw),
]
def rows():
    for label, text, consumer in CONSUMERS:
        for K in KINDS:
            # (The hash of the key of the cache has the address of a mark in it, so how often this one is asked differs from run to run.)
            if label == 'lru_cache, then plain' and K is No: continue
            for c in (cached, cached_typed, cached_a): c.cache_clear()
            m = {K(text): 1}
            del LOG[:]
            show('%s | %s' % (label, K.__name__), lambda: consumer(m))
    for K in KINDS:
        del LOG[:]
        show('class X(**{K(metaclass): Meta}) | %s' % K.__name__, lambda: class_statement_metaclass_key(K))
if sys.argv[1:] == ['rows']:
    rows()
else:
    for seed in ('1', '2', '3'):
        out = subprocess.run([sys.executable, __file__, 'rows'], env={**os.environ, 'PYTHONHASHSEED': seed}, capture_output=True, text=True)
        print('seed %s: status %d, %d rows, %s %s' % (seed, out.returncode, len(out.stdout.splitlines()), hashlib.sha256(out.stdout.encode()).hexdigest()[:16], out.stderr[-300:]))
        if seed == '1': print(out.stdout, end='')
