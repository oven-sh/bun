# A defaultdict holds its factory as a member: there is nothing between the two. So a collection counts one object for a defaultdict, gc.DEBUG_SAVEALL saves one, and whatever the factory is, a list too, it is an object
# like any other, to which the defaultdict refers.
import gc
from collections import defaultdict
def collected(make):
    gc.collect(); make(); return gc.collect()
def with_a_factory(): d = defaultdict(list); d[0] = d
def without(): d = defaultdict(); d[0] = d
def plain(): d = {}; d[0] = d
def tree():
    make = lambda: defaultdict(make); root = make(); root[1][2][3]; root[0] = root
print('collected: with a factory', collected(with_a_factory), '| without', collected(without), '| a plain dict', collected(plain), '| a tree of four, made by a lambda', collected(tree))
gc.collect(); gc.set_debug(gc.DEBUG_SAVEALL); with_a_factory(); gc.collect(); gc.set_debug(0)
print('saved:', sorted(type(o).__name__ for o in gc.garbage)); gc.garbage.clear()
class Callable:
    def __call__(self): return 0
class L(Callable, list): pass
class D(Callable, dict): pass
class S(Callable, set): pass
class T(Callable, tuple): pass
x = Callable()
factories = L([x]), D(k=x), S([x]), T([x]), [x], {'k': x}, (x,), x, list, 'a str'
for factory in factories:
    d = defaultdict(); d.default_factory = factory
    is_object = not isinstance(factory, (str, type))
    print('%-8s' % type(factory).__name__, 'the defaultdict refers to', sorted(type(o).__name__ for o in gc.get_referents(d)), '| to the factory itself:', any(o is factory for o in gc.get_referents(d)),
          '| is named its referrer:', is_object and any(o is d for o in gc.get_referrers(factory)), '| the factory is among all objects:', is_object and gc.is_tracked(factory) and any(o is factory for o in gc.get_objects()))
print('who refers to what the factories hold:', sorted(type(o).__name__ for o in gc.get_referrers(x) if o is not globals() and o is not factories))
print('tuples of one type among all objects:', sum(1 for o in gc.get_objects() if type(o) is tuple and len(o) == 1 and o[0] is list))
