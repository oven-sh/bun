# With reference counts an object goes like this: its finalizer is called; the weak references to it die; then what it held goes. So the finalizer of a child that asks a weak reference for its parent is told
# that the parent has gone. A collector that finds a parent and its children at once, and calls their finalizers one behind the other, has to do for the weak references what lies in between.
# Every scene here is of that kind: something five levels deep dies in the same collection, or the program comes to its end and has no function and no class of its own (so that its namespace lies in no cycle,
# and reference counts free all of it). All the references are to objects with finalizers.
# In the first part nothing that lives on holds the references: they die with what asks them. In the second part something does, and a finalizer brings its object back: those references have to live on.
import gc, os, subprocess, sys, weakref

log = []; live = []; kept = []
class N:
    def __init__(self, name, ask=None, comes_back=False): self.name = name; self.ask = ask; self.comes_back = comes_back
    def method(self): pass
    def __del__(self):
        log.append(self.name if self.ask is None else '%s(%s)' % (self.name, self.ask()))
        if self.comes_back: kept.append(self)
def deep(x, n=4):        # So many more objects with finalizers below x.
    for i in range(n): x.below = N('.'); x = x.below
def says(reference): return lambda: 'gone' if reference() is None else 'ALIVE'
class Ref(weakref.ref): pass

def a_chain_of_five():
    top = x = N('n0')
    for i in range(1, 5): x.below = N('n%d' % i, says(weakref.ref(x))); x = x.below
def a_pair_beside_a_chain_of_five():
    h = N('h'); h.c = N('c', says(weakref.ref(h))); z = N('z'); deep(z)
    del h; del z
def the_grandchild_asks_for_the_top():
    a = N('a'); a.b = N('b'); a.b.c = N('c', says(weakref.ref(a))); deep(a.b.c)
def a_sibling_asks_for_its_elder_sibling():
    a = N('a'); a.x = N('x'); a.y = N('y', says(weakref.ref(a.x))); deep(a.y)
def one_asks_for_another_that_has_nothing_to_do_with_it():
    x = N('x'); y = N('y', says(weakref.ref(x))); deep(y)
    del x; del y
def a_reference_of_a_class_of_the_programs():
    h = N('h'); h.c = N('c', says(Ref(h))); deep(h.c)
def a_proxy():
    h = N('h'); p = weakref.proxy(h)
    def ask():
        try: return 'ALIVE ' + p.name
        except ReferenceError: return 'gone'
    h.c = N('c', ask); deep(h.c)
def what_a_reference_says_of_itself():
    h = N('h'); r = weakref.ref(h); h.c = N('c', lambda: 'dead' if 'dead' in repr(r) else 'not dead'); deep(h.c)
def a_weak_method():
    h = N('h'); h.c = N('c', says(weakref.WeakMethod(h.method))); deep(h.c)
def a_weak_value_dictionary_that_the_child_holds():
    h = N('h'); d = weakref.WeakValueDictionary(); d['h'] = h; h.c = N('c', lambda: 'gone' if d.get('h') is None else 'ALIVE'); deep(h.c)
def a_weak_set_that_the_child_holds():
    h = N('h'); s = weakref.WeakSet(); s.add(h); h.c = N('c', lambda: 'ALIVE' if list(s) else 'gone'); deep(h.c)
def a_finalizer_that_collects():
    h = N('h', lambda: 'has collected %d' % gc.collect()); h.c = N('c', says(weakref.ref(h))); deep(h.c)
def a_finalizer_asks_for_its_own_object_and_for_what_goes_later():
    h = N('h'); h.c = N('c'); own = weakref.ref(h); later = weakref.ref(h.c); h.ask = lambda: says(own)() + ' ' + says(later)(); deep(h.c)
def a_generator_with_a_finally():
    def g(held):
        try: yield
        finally: log.append('generator')
    c = N('c'); deep(c); it = g(c); next(it); c.ask = says(weakref.ref(it))
    del c; del it

for scene in (a_chain_of_five, a_pair_beside_a_chain_of_five, the_grandchild_asks_for_the_top, a_sibling_asks_for_its_elder_sibling, one_asks_for_another_that_has_nothing_to_do_with_it,
              a_reference_of_a_class_of_the_programs, a_proxy, what_a_reference_says_of_itself, a_weak_method, a_weak_value_dictionary_that_the_child_holds, a_weak_set_that_the_child_holds, a_finalizer_that_collects,
              a_finalizer_asks_for_its_own_object_and_for_what_goes_later, a_generator_with_a_finally):
    gc.collect(); log.clear()
    scene(); gc.collect()
    print('%s: %s' % (scene.__name__, ' '.join(str(word) for word in log)))

# What lives on. (What the finalizers say is not printed: what an object held is finalized here though its finalizer has brought it back, which is declared.)
def watch(x):
    told = []
    r = weakref.ref(x); t = weakref.ref(x, lambda reference: told.append('callback')); p = weakref.proxy(x, lambda reference: told.append('callback of the proxy'))
    d = weakref.WeakValueDictionary(); d[1] = x; s = weakref.WeakSet(); s.add(x); k = weakref.WeakKeyDictionary(); k[x] = 1; f = weakref.finalize(x, told.append, 'finalize')
    def census():
        try: name = p.name
        except ReferenceError: name = 'gone'
        return '%s %s %s %d %d %d %s %s' % (says(r)(), says(t)(), name, len(d), len(s), len(k), f.alive, told)
    return census
def the_top_comes_back():
    top = N('top', comes_back=True); deep(top); return watch(top)
def one_in_the_middle_comes_back():
    top = N('top'); top.below = N('middle', comes_back=True); deep(top.below); return watch(top.below)
def what_the_one_that_comes_back_holds():
    top = N('top', comes_back=True); top.below = N('held'); deep(top.below); return watch(top.below)
def what_it_holds_three_levels_down():
    top = N('top', comes_back=True); deep(top); return watch(top.below.below.below)
for scene in (the_top_comes_back, one_in_the_middle_comes_back, what_the_one_that_comes_back_holds, what_it_holds_three_levels_down):
    gc.collect(); census = scene(); gc.collect(); print('%s: %s' % (scene.__name__, census()))
    kept.clear(); gc.collect(); print('%s, let go of for good: %s' % (scene.__name__, census()))

# At the end of a program. Each is a program of its own, without a function and without a class: what it needs of those is made by exec() in a namespace that is dropped.
head = '''import sys, weakref
ns = {}
exec("""import os
def say(t, w=os.write): w(1, (t + ' ').encode())
class N:
    def __init__(s, name): s.name = name; s.r = None
    def __del__(s, say=say): say(s.name if s.r is None else s.name + ('(gone)' if s.r() is None else '(ALIVE)'))
""", ns)
N = ns['N']; del ns
'''
at_exit = {
    'a child asks for its parent': "h = N('h'); h.c = N('c'); h.c.r = weakref.ref(h)",
    'three levels, each asks for the one above': "a = N('a'); a.c = N('b'); a.c.r = weakref.ref(a); a.c.c = N('c'); a.c.c.r = weakref.ref(a.c)",
    'the grandchild asks for the top': "a = N('a'); a.c = N('b'); a.c.c = N('c'); a.c.c.r = weakref.ref(a)",
    'a name asks for an earlier name': "h = N('h'); z = N('z'); z.r = weakref.ref(h)",
}
for name, body in at_exit.items():
    done = subprocess.run([sys.executable, '-c', head + body + '\ndel N\n'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    print('at exit, %s: status %d: %s' % (name, done.returncode, done.stdout.decode().strip()))
