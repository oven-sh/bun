# Where a collector calls the finalizers of a parent and of its children one behind the other, a weak reference to the parent that dies with them dies behind the finalizer of the parent. Whether a reference dies with
# them is known for sure only afterwards: what holds it may be kept by the collection itself (cyclic garbage that is left for later, gc.DEBUG_SAVEALL), or a finalizer may save it. Such a reference has somebody
# to tell, and its callback has to be called: a WeakValueDictionary that has been saved must not keep an entry for ever that gives nothing.
# WHEN it is called is not asked here (with reference counts at once, behind the finalizer of the parent): what the finalizers say and what the callbacks say are printed apart.
# In every scene something five levels deep dies in one collection.
import gc, os, subprocess, sys, threading, weakref

log = []; told = []; saved = []
class N:
    def __init__(self, name, ask=None, then=None): self.name = name; self.ask = ask; self.then = then
    def __del__(self):
        log.append(self.name if self.ask is None else '%s(%s)' % (self.name, self.ask()))
        if self.then is not None: self.then(self)
class Plain: pass
def deep(x, n=4):        # So many more objects with finalizers below x.
    for i in range(n): x.below = N('.'); x = x.below
def says(reference): return lambda: 'gone' if reference() is None else 'ALIVE'
def callback(reference): told.append('callback, and the reference says %s' % says(reference)())

def the_child_saves_the_reference_that_it_holds():
    h = N('h'); h.c = N('c', then=lambda c: saved.append(c.r)); h.c.r = weakref.ref(h, callback); h.c.ask = says(h.c.r); deep(h.c)
def the_finalizer_of_the_parent_saves_the_references_to_it():
    h = N('h', then=lambda h: saved.extend(weakref.getweakrefs(h))); h.c = N('c'); h.c.r = weakref.ref(h, callback); h.c.ask = says(h.c.r); deep(h.c)
def all_garbage_is_saved():
    gc.set_debug(gc.DEBUG_SAVEALL)
    cycle = Plain(); cycle.me = cycle; h = N('h'); h.c = N('c', says(weakref.ref(h))); deep(h.c); cycle.r = weakref.ref(h, callback)
    del cycle, h; gc.collect(); gc.set_debug(0); saved.append(len(gc.garbage) > 0); gc.garbage.clear()
def the_child_saves_a_dictionary():
    h = N('h'); d = weakref.WeakValueDictionary(); d['h'] = h; h.c = N('c', lambda: 'gone' if d.get('h') is None else 'ALIVE', lambda c: saved.append(d)); deep(h.c)
def the_child_saves_a_set():
    h = N('h'); s = weakref.WeakSet(); s.add(h); h.c = N('c', lambda: 'ALIVE' if list(s) else 'gone', lambda c: saved.append(s)); deep(h.c)
def the_child_saves_a_dictionary_with_weak_keys():
    h = N('h'); d = weakref.WeakKeyDictionary(); d[h] = 1; h.c = N('c', lambda: 'ALIVE' if list(d) else 'gone', lambda c: saved.append(d)); deep(h.c)
def shown(x): return '%s of length %d' % (type(x).__name__, len(x)) if hasattr(x, '__len__') else type(x).__name__ if isinstance(x, weakref.ref) else x
for scene in (the_child_saves_the_reference_that_it_holds, the_finalizer_of_the_parent_saves_the_references_to_it, all_garbage_is_saved, the_child_saves_a_dictionary, the_child_saves_a_set,
              the_child_saves_a_dictionary_with_weak_keys):
    gc.collect(); log.clear(); told.clear(); saved.clear()
    scene(); gc.collect()
    print('%s: %s | %s | saved: %s' % (scene.__name__, ' '.join(log), told, [shown(x) for x in saved]))

# A thread that waits collects, and leaves cyclic garbage for later.
def a_thread_that_waits():
    finalized = threading.Event(); heard = threading.Event()
    cycle = N('cycle'); cycle.me = cycle; h = N('h'); h.c = N('c', says(weakref.ref(h))); deep(h.c, 3); h.c.below.below.below.below = N('last', then=lambda last: finalized.set())
    cycle.r = weakref.ref(h, lambda reference: (callback(reference), heard.set()))
    del cycle, h
    return finalized.wait(20), heard.wait(20)
gc.collect(); log.clear(); told.clear()
print('a_thread_that_waits: %s: %s | %s' % (a_thread_that_waits(), ' '.join(word for word in log if word != 'cycle'), told))
gc.collect()

# At the end of a program: what reference counts would have freed goes first, and cyclic garbage is left for later. Each is a program of its own. The words are sorted: see above.
head = '''import weakref
ns = {}
exec("""import os
def say(t, w=os.write): w(1, (t + ' ').encode())
class N:
    def __init__(s, name): s.name = name; s.r = None
    def __del__(s, say=say): say(s.name if s.r is None else s.name + ('(gone)' if s.r() is None else '(ALIVE)'))
class Plain: pass
def callback(r, say=say): say('callback')
""", ns)
N = ns['N']; Plain = ns['Plain']; callback = ns['callback']; del ns
h = x = N('h'); x.c = N('c'); x.c.r = weakref.ref(h); x = x.c
x.c = N('.'); x = x.c; x.c = N('.'); x = x.c; x.c = N('.'); del x
cycle = N('cycle'); cycle.me = cycle
'''
at_exit = {
    'cyclic garbage with a finalizer holds the reference': "cycle.w = weakref.ref(h, callback)",
    'a plain object that hangs off such garbage holds it': "cycle.p = Plain(); cycle.p.w = weakref.ref(h, callback)",
}
for name, body in at_exit.items():
    done = subprocess.run([sys.executable, '-c', head + body + '\ndel cycle, h, N, Plain, callback\n'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    print('at exit, %s: status %d: %s' % (name, done.returncode, ' '.join(sorted(done.stdout.decode().split()))))
