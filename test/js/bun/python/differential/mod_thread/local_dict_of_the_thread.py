# threading.local: the dict that a thread has in it is not the __dict__ of the object. Everything that could tell where it is kept: vars, dir, copy, pickle, getattr_static, the methods of
# object applied to it, other threads, an __init__ that raises, the dict going with the thread and with the object; for the type itself and for three kinds of derived class.
import threading, copy, pickle, inspect, gc, weakref, sys
def show(label, f):
    try: r = ('returned', f())
    except BaseException as e: r = (type(e).__name__, str(e)[:120])
    print(label, r)
class Sub(threading.local):
    k = 'of the class'
    def __init__(self, *a, **kw): self.made_in = threading.current_thread().name; self.args = (a, sorted(kw))
    @property
    def p(self): return 'property sees %s' % self.x
class Slots(threading.local):
    __slots__ = ('s',)
class Plain(threading.local): pass
def in_thread(f):
    out = []
    t = threading.Thread(target=lambda: out.append(f()), name='other'); t.start(); t.join(); return out[0]
for name, make in (('local', threading.local), ('Plain', Plain), ('Sub', lambda: Sub(1, b=2)), ('Slots', Slots)):
    l = make(); l.x = 1
    show('%s vars' % name, lambda: sorted(vars(l)))
    show('%s __dict__ is the same twice' % name, lambda: l.__dict__ is l.__dict__)
    show('%s dir has x' % name, lambda: 'x' in dir(l))
    show('%s in its type: __dict__' % name, lambda: [c.__name__ for c in type(l).__mro__ if '__dict__' in vars(c)])
    show('%s in its type: __weakref__' % name, lambda: [c.__name__ for c in type(l).__mro__ if '__weakref__' in vars(c)])
    show('%s getattr_static x' % name, lambda: inspect.getattr_static(l, 'x', 'default'))
    show('%s object.__getattribute__ x' % name, lambda: object.__getattribute__(l, 'x'))
    show('%s object.__getattribute__ __dict__' % name, lambda: sorted(object.__getattribute__(l, '__dict__')))
    show('%s object.__setattr__ y' % name, lambda: object.__setattr__(l, 'y', 2))
    show('%s l.y' % name, lambda: l.y)
    show('%s object.__getattribute__ y' % name, lambda: object.__getattribute__(l, 'y'))
    show('%s vars afterwards' % name, lambda: sorted(vars(l)))
    show('%s object.__delattr__ y' % name, lambda: object.__delattr__(l, 'y'))
    show('%s object.__delattr__ x' % name, lambda: object.__delattr__(l, 'x'))
    show('%s l.x' % name, lambda: l.x)
    show('%s in another thread: vars' % name, lambda: in_thread(lambda: sorted(vars(l))))
    show('%s in another thread: x' % name, lambda: in_thread(lambda: getattr(l, 'x', 'none')))
    show('%s set in another thread, seen here' % name, lambda: (in_thread(lambda: setattr(l, 'z', 3)), getattr(l, 'z', 'none'))[1])
    show('%s copy.copy' % name, lambda: sorted(vars(copy.copy(l))))
    show('%s copy.deepcopy' % name, lambda: sorted(vars(copy.deepcopy(l))))
    show('%s pickle' % name, lambda: len(pickle.dumps(l)) > 0)
    show('%s __reduce_ex__(2)' % name, lambda: [type(x).__name__ for x in l.__reduce_ex__(2)])
    show('%s __getstate__' % name, lambda: l.__getstate__())
    show('%s weakref' % name, lambda: weakref.ref(l)() is l)
    show('%s del x' % name, lambda: (delattr(l, 'x'), sorted(vars(l)))[1])
    show('%s del x again' % name, lambda: delattr(l, 'x'))
    show('%s __dict__ update' % name, lambda: (l.__dict__.update(w=5), l.w)[1])
    show('%s __dict__ = {}' % name, lambda: setattr(l, '__dict__', {}))
    show('%s del __dict__' % name, lambda: delattr(l, '__dict__'))
    show('%s __class__ = Plain' % name, lambda: (setattr(l, '__class__', Plain), type(l).__name__)[1])
    show('%s repr' % name, lambda: repr(l).split(' at ')[0])
    show('%s hasattr __dict__' % name, lambda: hasattr(l, '__dict__'))
    show('%s sizeof is an int' % name, lambda: isinstance(sys.getsizeof(l), int))
    show('%s referents have the dict' % name, lambda: any(r is l.__dict__ for r in gc.get_referents(l)))
s = Sub(1, b=2); s.x = 7
show('Sub p', lambda: s.p); show('Sub k', lambda: s.k); show('Sub made_in', lambda: s.made_in); show('Sub made_in, other thread', lambda: in_thread(lambda: (s.made_in, s.args)))
show('Sub p, other thread', lambda: in_thread(lambda: getattr(s, 'p', 'no p')))
sl = Slots(); sl.s = 1
show('Slots s here', lambda: sl.s); show('Slots s, other thread', lambda: in_thread(lambda: getattr(sl, 's', 'none'))); show('Slots other attribute', lambda: (setattr(sl, 'q', 2), sl.q, sorted(vars(sl))))
class Raises(threading.local):
    n = 0
    def __init__(self):
        Raises.n += 1
        if threading.current_thread().name == 'other' and Raises.n < 3: raise ValueError('init %d' % Raises.n)
        self.ok = Raises.n
r = Raises()
def twice():
    out = []
    for i in range(2):
        try: out.append(r.ok)
        except ValueError as e: out.append(str(e))
    return out
show('__init__ raises in the other thread, then not', lambda: in_thread(twice))
# the dict goes with the thread
l = threading.local()
class Tell:
    def __del__(self): print('the value of the other thread is finalized')
in_thread(lambda: setattr(l, 'v', Tell())); gc.collect(); print('after the thread')
# and with the object
l = threading.local(); l.v = Tell(); del l; gc.collect(); print('after the object')
