# An object x is held by a holder in one way. Does a walk by gc.get_referents() from the holder come to x? And does a climb by gc.get_referrers() from x come to the holder? One line a way. (By which objects they go differs
# from one interpreter to another, and is not written out.) And whoever gc.get_referrers() names refers to what it is named for, by gc.get_referents().
# ONE KIND IS APART: a threading.local. CPython leads from it to what it holds by containers of its own, which it hands out: the tuple and the dict of what it was made with, and a dict of the dicts of all threads. An
# interpreter that has other memory in their place, and does not hand that out, cannot lead there. What it can say as CPython does is what the object does NOT refer to: neither to what it holds, nor to the dict of
# the thread; that nobody names the object as a referrer of either; and that the dict of the thread refers to the attribute.
import gc, sys, types, collections, functools, itertools, operator, weakref, contextvars, threading, io, asyncio, typing, csv, pickle, struct, array, queue, heapq, re, copy
class X:
    def __call__(self, *a, **k): return None
    def __iter__(self): return iter(())
    def write(self, s): return 0
    def read(self, n=-1): return b''
    def readline(self): return ''
    def readable(self): return True
    def writable(self): return True
    def seekable(self): return False
    closed = False
    def flush(self): pass
    def close(self): pass
    def __index__(self): return 1
ways = []
def way(f): ways.append(f); return f
def sub(base, slots):
    if slots: return type('Sub', (base,), {'__slots__': ('a',)})
    return type('Sub', (base,), {})
for base in (dict, list, set, frozenset, tuple, int, str, bytes, float, collections.OrderedDict, collections.defaultdict, collections.deque, collections.Counter, bytearray, Exception, functools.partial, weakref.ref, property, types.SimpleNamespace, threading.local, array.array, io.BytesIO, io.StringIO, types.ModuleType, complex, object):
    for slots in (False, True):
        def f(x, base=base, slots=slots):
            try: C = sub(base, slots)
            except TypeError: return None
            if base is functools.partial: h = C(print)
            elif base is weakref.ref: h = C(X)
            elif base is array.array: h = C('b')
            elif base is types.ModuleType: h = C('m')
            else: h = C()
            h.a = x; return h
        f.__name__ = 'attribute_of_a_%s_subclass%s' % (base.__name__, '_with_slots' if slots else '')
        ways.append(f)
@way
def defaultdict_factory(x): return collections.defaultdict(x)
@way
def local_attribute(x): t = threading.local(); t.a = x; return t
@way
def local_subclass_argument(x):
    class L(threading.local):
        def __init__(self, a): pass
    return L(x)
@way
def local_subclass_keyword(x):
    class L(threading.local):
        def __init__(self, a=None): pass
    return L(a=x)
@way
def ordered_dict_key(x): return collections.OrderedDict([(x, 1)])
@way
def counter_key(x): return collections.Counter([x])
@way
def chainmap(x): return collections.ChainMap({'a': x})
@way
def deque_item(x): return collections.deque([x])
@way
def simple_queue_item(x): q = queue.SimpleQueue(); q.put(x); return q
@way
def property_getter(x): return property(x)
@way
def static_method(x): return staticmethod(x)
@way
def class_method(x): return classmethod(x)
@way
def weakref_callback(x): return weakref.ref(X, x)
@way
def weak_method(x): return weakref.finalize(X, x)
@way
def cell(x): return types.CellType(x)
@way
def a_slice(x): return slice(x)
@way
def generic_alias(x): return types.GenericAlias(list, (x,))
@way
def typevar_bound(x): return typing.TypeVar('T', bound=x)
@way
def cycle_saved(x): c = itertools.cycle([x]); next(c); return c
@way
def repeat(x): return itertools.repeat(x)
@way
def chain(x): return itertools.chain(x)
@way
def accumulate_function(x): return itertools.accumulate([], x)
@way
def accumulate_initial(x): return itertools.accumulate([], initial=x)
@way
def groupby_key(x): return itertools.groupby([], x)
@way
def tee_item(x): a, b = itertools.tee([x]); next(a); return b
@way
def starmap_function(x): return itertools.starmap(x, [])
@way
def islice_of(x): return itertools.islice(x, 1)
@way
def product_pool(x): return itertools.product([x])
@way
def combinations_pool(x): return itertools.combinations([x], 1)
@way
def zip_longest_fill(x): return itertools.zip_longest([], fillvalue=x)
@way
def batched(x): return itertools.batched(x, 1)
@way
def pairwise_of(x): return itertools.pairwise(x)
@way
def itemgetter(x): return operator.itemgetter(x)
@way
def itemgetter_two(x): return operator.itemgetter(x, 1)
@way
def methodcaller_argument(x): return operator.methodcaller('a', x)
@way
def methodcaller_keyword(x): return operator.methodcaller('a', k=x)
@way
def map_function(x): return map(x, [])
@way
def filter_function(x): return filter(x, [])
@way
def zip_iterator(x): return zip(x)
@way
def enumerate_iterator(x): return enumerate(x)
@way
def callable_iterator(x): return iter(x, None)
@way
def callable_iterator_sentinel(x): return iter(print, x)
@way
def list_iterator(x): return iter([x])
@way
def tuple_iterator(x): return iter((x,))
@way
def dict_iterator(x): return iter({x: 1})
@way
def set_iterator(x): return iter({x})
@way
def reversed_list(x): return reversed([x])
@way
def dict_view(x): return {x: 1}.keys()
@way
def a_super(x): return super(X, x)
@way
def partial_function(x): return functools.partial(x)
@way
def partial_method(x): return functools.partialmethod(x)
@way
def cached_property(x): return functools.cached_property(x)
@way
def lru_wrapped(x): return functools.lru_cache(x)
@way
def lru_key(x):
    f = functools.lru_cache(4)(lambda a: 1); f(x); return f
@way
def lru_result_unbounded(x):
    f = functools.lru_cache(None)(lambda a: x); f(1); return f
@way
def cmp_to_key(x): return functools.cmp_to_key(x)
@way
def cmp_key_object(x): return functools.cmp_to_key(print)(x)
@way
def singledispatch(x): return functools.singledispatch(x)
@way
def contextvar_default(x): return contextvars.ContextVar('v', default=x)
@way
def context_value(x):
    v = contextvars.ContextVar('v'); c = contextvars.Context(); c.run(v.set, x); return c
@way
def token_old_value(x):
    v = contextvars.ContextVar('v'); c = contextvars.Context(); c.run(v.set, x); return c.run(v.set, 1)
@way
def future_result(x):
    loop = asyncio.new_event_loop(); f = loop.create_future(); f.set_result(x); loop.close(); return f
@way
def future_callback(x):
    loop = asyncio.new_event_loop(); f = loop.create_future(); f.add_done_callback(x); loop.close(); return f
@way
def future_two_callbacks(x):
    loop = asyncio.new_event_loop(); f = loop.create_future(); f.add_done_callback(print); f.add_done_callback(x); loop.close(); return f
@way
def buffered_raw(x): return io.BufferedWriter(x)
@way
def text_wrapper_buffer(x): return io.TextIOWrapper(x, encoding='utf-8')
@way
def csv_reader(x): return csv.reader(x)
@way
def csv_writer(x): return csv.writer(x)
@way
def pickler_file(x): return pickle.Pickler(x)
@way
def pickler_memo(x):
    p = pickle.Pickler(io.BytesIO()); l = [x]
    try: p.dump(l)
    except Exception: pass
    return p
@way
def unpickler_file(x): return pickle.Unpickler(x)
@way
def exception_argument(x): return Exception(x)
@way
def exception_cause(x):
    e = Exception(); e.__cause__ = None; e.__notes__ = [x]; return e
@way
def exception_group(x): return ExceptionGroup('g', [Exception(x)])
@way
def stop_iteration_value(x): return StopIteration(x)
@way
def attribute_error_object(x): return AttributeError(name='a', obj=x)
@way
def mappingproxy_value(x): return types.MappingProxyType({'a': x})
@way
def bound_method(x): return types.MethodType(print, x)
@way
def method_wrapper(x): return x.__str__
@way
def builtin_method(x): l = [x]; return l.append
@way
def function_default(x): return (lambda a=x: 1)
@way
def function_annotation(x):
    def f(): pass
    f.__annotations__ = {'a': x}; return f
@way
def function_globals(x): return types.FunctionType((lambda: 1).__code__, {'a': x})
@way
def class_base(x): return type('C', (type(x),), {})
@way
def class_attribute(x): return type('C', (), {'a': x})
@way
def module_attribute(x): m = types.ModuleType('m'); m.a = x; return m
@way
def thread_target(x): return threading.Thread(target=x)
@way
def union_type(x): return int | type(x)
@way
def dynamic_class_attribute(x): return types.DynamicClassAttribute(x)
def walk(h, x, depth=5):
    seen = {id(h)}; level = [(h, (type(h).__name__,))]
    for _ in range(depth):
        following = []
        for o, path in level:
            for r in gc.get_referents(o):
                if r is x: return path
                if id(r) in seen or isinstance(r, (type, types.ModuleType, types.FunctionType, types.BuiltinFunctionType, types.CodeType)) and r is not h: continue
                seen.add(id(r)); following.append((r, path + (type(r).__name__,)))
        level = following
    return None
names, holders, targets, found, apart = [], [], [], [], []
for f in ways:
    x = X()
    if f.__name__ in ('class_base', 'union_type'): x = type('Y', (X,), {})()
    try: h = f(x)
    except Exception as e: print('%-52s (%s)' % (f.__name__, type(e).__name__)); continue
    if h is None: continue
    target = type(x) if f.__name__ in ('class_base', 'union_type') else x
    if isinstance(h, threading.local) and 'slots' not in f.__name__: apart.append((f.__name__, h, x)); continue
    names.append(f.__name__); holders.append(h); targets.append(target); found.append(walk(h, target) is not None)
del x, h, target
# The other direction, for all the ways at once: gc.get_referrers() takes a collection and a look at the whole heap each time. From the targets up, level by level: whoever is named has to refer to what it is named for
# (named => refers), and the climb has to come to the holder (refers => named).
among = lambda o, objects: any(r is o for r in objects)
passed_by = (type, types.ModuleType, types.FunctionType, types.BuiltinFunctionType, types.CodeType, types.FrameType)
of_this_test = {id(o) for o in (names, holders, targets, found, apart, ways, globals())}
holder_of = {}
for i, h in enumerate(holders): holder_of.setdefault(id(h), []).append(i)
level = {}; keep = {}          # id(object) -> the ways by whose climb it has been come to
for i, t in enumerate(targets): level.setdefault(id(t), set()).add(i); keep[id(t)] = t
climbed = [False] * len(names); not_mirrored = set()
for depth in range(5):
    named = gc.get_referrers(*[keep[k] for k in level]); above = {}
    for o in named:
        if id(o) in of_this_test or o is named or isinstance(o, types.FrameType): continue
        which = set()
        for r in gc.get_referents(o): which |= level.get(id(r), set())
        if not which: not_mirrored.add(type(o).__name__); continue
        for i in which:
            if holders[i] is o: climbed[i] = True
        if not isinstance(o, passed_by): above.setdefault(id(o), set()).update(i for i in which if not climbed[i]); keep[id(o)] = o
    del named
    level = {k: v for k, v in above.items() if v}
    of_this_test |= {id(level), id(above), id(keep)}
    if not level: break
for i, name in enumerate(names): print('%-52s %s; %s' % (name, 'found' if found[i] else 'NOT FOUND', 'the holder is come to from it' if climbed[i] else 'THE HOLDER IS NOT COME TO'))
print('named as a referrer and does not refer to it:', sorted(not_mirrored))
for name, h, x in apart:
    of_x = gc.get_referrers(x)
    print('%-52s apart: x among its referents: %s; its dict: %s; it among the referrers of x: %s; of its dict: %s; its dict among the referrers of x: %s' % (name, among(x, gc.get_referents(h)),
          among(h.__dict__, gc.get_referents(h)), among(h, of_x), among(h, gc.get_referrers(h.__dict__)), among(h.__dict__, of_x)))
    del of_x
# A type that is not allocated is referred to by few: not by each of its instances.
keep = [(i, [i]) for i in range(5000)]
print('referrers of tuple: fewer than 1000:', len(gc.get_referrers(tuple)) < 1000, '| of list:', len(gc.get_referrers(list)) < 1000)
# The values of a struct sequence that are no items are among its referents.
import os, time
for name, o in (('os.stat()', os.stat('/')), ('time.localtime()', time.localtime()), ('sys.flags', sys.flags)):
    print(name, sorted(collections.Counter(type(r).__name__ for r in gc.get_referents(o)).items()))
# The factory of a defaultdict is an object of the program's, whatever its kind: a list is no memory of the defaultdict's.
class CallableList(list):
    def __call__(self): return 0
for name, make in (('a list', lambda x: [x]), ('a tuple', lambda x: (x,)), ('a dict', lambda x: {'a': x}), ('a callable list', lambda x: CallableList([x])), ('a str', lambda x: 'text of a factory')):
    x = X(); d = collections.defaultdict(); factory = make(x); d.default_factory = factory; of_x = gc.get_referrers(x)
    print('the factory is %s: among the referents of the defaultdict: %s; x among them: %s; the defaultdict among the referrers of the factory: %s; of x: %s; the factory among the referrers of x: %s; among all objects: %s' % (
        name, among(factory, gc.get_referents(d)), among(x, gc.get_referents(d)), among(d, gc.get_referrers(factory)), among(d, of_x), among(factory, of_x), among(factory, gc.get_objects())))
    del of_x
# An object of a type that is not allocated does not refer to its type, unless it holds it as a value.
for name, o in (('property(property)', property(property)), ('map(map, [])', map(map, [])), ('staticmethod(staticmethod)', staticmethod(staticmethod)), ('slice(slice)', slice(slice)), ('property(len)', property(len))):
    print('%s: its type among its referents: %s; it among the referrers of its type: %s' % (name, among(type(o), gc.get_referents(o)), among(o, gc.get_referrers(type(o)))))
# What lies in the namespace of such a type has a referrer all the same.
print('the referrers of list.append:', len(gc.get_referrers(list.append)), '| of int.__add__:', len(gc.get_referrers(int.__add__)))
