# gc.get_referrers(t) names h if and only if t is among gc.get_referents(h): CPython's collector puts one question for both. Here t is mostly a TYPE. Every object has one, also what an interpreter keeps for
# itself inside an object (a tuple of further values, a weak reference of its own): that such a thing is a tuple does not make the object that it lies in a referrer of `tuple`.
import collections, gc, os, sys, time, weakref
class X: pass
class L(list): pass
class D(dict): pass
class SL(list): __slots__ = ('a',)
class M(type): pass
class E(X): pass
class OfM(metaclass=M): pass
keep = []
def weakly(o): keep.append(weakref.ref(o)); return o
def slot(value): o = SL(); o.a = value; return o
s = 'a str made at run time %d' % len(sys.argv); s2 = 'another %d' % len(sys.argv); x = X()
with_a_str = collections.defaultdict(); with_a_str.default_factory = s2
# A tuple of what the collector keeps no track of is not the collector's either, once a collection has come to it: it is no referrer, as it is not among all objects.
of_atoms = (int, 'a'); gc.collect()
asked = [
    ((tuple,), {'defaultdict(list)': collections.defaultdict(list), 'defaultdict()': collections.defaultdict(), 'sys.flags': sys.flags, 'os.stat()': os.stat('/'), 'time.localtime()': time.localtime(),
                'sys.version_info': sys.version_info, '(tuple, [])': (tuple, []), '(1, [])': (1, [])}),
    ((weakref.ref,), {'a set that is weakly referred to': weakly(set()), 'a set': set(), 'a frozenset that is': weakly(frozenset([1])), 'an OrderedDict that is': weakly(collections.OrderedDict()),
                      'an instance of a list subclass that is': weakly(L()), 'of a dict subclass': weakly(D()), 'of a class': weakly(X()), '[weakref.ref]': [weakref.ref]}),
    ((list,), {'[list]': [list], '[1]': [1], 'defaultdict(list)': collections.defaultdict(list), 'a list subclass with list in a slot': slot(list), 'with an empty slot': SL()}),
    ((SL,), {'a list subclass with its class in a slot': slot(SL), 'with an empty slot': SL(), '[the class]': [SL]}),
    ((dict,), {"{'k': dict}": {'k': dict}, "{'k': 1}": {'k': 1}, '{dict: 1}': {dict: 1}, 'a dict subclass with dict as a value': D(k=dict), 'an empty one': D()}),
    ((set,), {'{set}': {set}, '{1}': {1}}),
    ((s,), {'{s: 1}': {s: 1}, "{'k': s}": {'k': s}, '{s: 1, 2: 3}': {s: 1, 2: 3}, '[s]': [s], '(s, [])': (s, []), '{s}': {s}, 'OrderedDict({s: 1})': collections.OrderedDict({s: 1}),
            'OrderedDict({1: s})': collections.OrderedDict({1: s}), "OrderedDict({'k': 1})": collections.OrderedDict({'k': 1})}),
    ((s, x), {'{s: x}': {s: x}, '{s: 1}': {s: 1}}),
    ((s2,), {'a defaultdict with a str for a factory': with_a_str}),
    ((int,), {"(int, 'a')": of_atoms, '(int, [])': (int, []), '[int]': [int]}),
    ((type,), {'a metaclass': M, 'a class': X, 'a class of that metaclass': OfM}),
    ((M,), {'a class of the metaclass': OfM, 'the metaclass': M}),
    ((object,), {'a class without a base': X, 'a class that derives from it': E}),
    ((X,), {'a class that derives from it': E, 'an instance': x}),
]
for objects, holders in asked:
    referrers = gc.get_referrers(*objects)
    print('asked about', ', '.join(o.__name__ if isinstance(o, type) else type(o).__name__ for o in objects))
    for name, h in holders.items():
        print('   %-48s is named: %-5s refers: %s' % (name, any(r is h for r in referrers), any(r is o for r in gc.get_referents(h) for o in objects)))
many = [collections.defaultdict(list) for _ in range(2000)]
print('of 2,000 defaultdicts with a factory, referrers of tuple:', sum(type(o) is collections.defaultdict for o in gc.get_referrers(tuple)), '| of list:', sum(any(o is d for d in many[:3]) for o in gc.get_referrers(list)))
def names(l): return sorted(repr(o) if isinstance(o, (str, int)) else type(o).__name__ for o in l)
print('the tuple of what is not kept track of: kept track of:', gc.is_tracked(of_atoms), '| among all objects:', any(o is of_atoms for o in gc.get_objects()))
print('how often a class refers to its base:', sum(o is object for o in gc.get_referents(X)), sum(o is X for o in gc.get_referents(E)), sum(o is type for o in gc.get_referents(M)), '| to the base of its base:', sum(o is object for o in gc.get_referents(E)))
print('an OrderedDict refers to', names(gc.get_referents(collections.OrderedDict([(s, 1), ('k', x)]))), '|', names(gc.get_referents(collections.OrderedDict([(s, 1), (2, x)]))), '|', names(gc.get_referents(collections.OrderedDict())))
