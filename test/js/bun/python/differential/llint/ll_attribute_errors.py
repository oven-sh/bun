# AttributeError: the text, and name and obj, which say which attribute of which object it was. They are set by whoever asked for the attribute,
# not by what found that it is not there. Every place in the program runs once: CPython's answer changes when an instruction is specialized.
import types
class P: pass
class S:
    __slots__ = ('a',)
class SS(S):
    __slots__ = ()
    def __setattr__(self, n, v): object.__setattr__(self, n, v)
    def __delattr__(self, n): object.__delattr__(self, n)
class D(P): pass
m = types.ModuleType('m')
p, s, ss = P(), S(), SS()
names = {id(p): 'p', id(s): 's', id(ss): 'ss', id(m): 'm', id(P): 'P', id(None): 'None'}
def show(tag, f):
    try:
        f()
    except AttributeError as e:
        print(tag, '|', e, '| name =', e.name, '| obj =', names.get(id(e.obj), type(e.obj).__name__))
def d1(): del P.zz
def d2(): del p.zz
def d3(): del m.zz
def d4(): del s.a
def d5(): delattr(P, 'zz')
def d6(): type.__delattr__(P, 'zz')
def d7(): object.__delattr__(p, 'zz')
def w1(): (5).real = 1
def w2(): len.__name__ = 1
def w3(): P.__mro__ = 1
def w4(): p.__weakref__ = 1
def w5(): del (5).real
def c1(): s.a()
def c2(): s.a
def u1(): super(D, D()).zz
def u2(): super(D, D()).zz()
def n1(): ss.zz = 1
def n2(): s.zz = 1
def n3(): del ss.zz
def n4(): del s.zz
def g1(): property().fget.zz
def g2(): P.zz
def g3(): p.zz
def g4(): m.zz
def g5(): (5).zz = 1
def g6(): None.zz
def x1(): object.__getattribute__(p, 'zz')
def x2(): type.__getattribute__(P, 'zz')
def x3(): p.__getattribute__('zz')
def x4(): types.ModuleType.__getattribute__(m, 'zz')
def x5(): P.__getattribute__(p, 'zz')
def x6(): object.__setattr__(s, 'zz', 1)
def x7(): s.__setattr__('zz', 1)
def x8(): type.__setattr__(int, 'zz', 1)
def x9(): m.__getattribute__('zz')
sup = super(SS, ss)
def u3(o=sup): o.zz
def u4(o=sup): o.a
def u5(o=sup): getattr(o, 'zz')
def u6(o=sup): o.zz = 1
def u7(o=sup): del o.zz
for f in (x1, x2, x3, x4, x5, x6, x7, x9, u3, u4, u5, u6, u7, d1, d2, d3, d4, d5, d6, d7, w1, w2, w3, w4, w5, c1, c2, u1, u2, n1, n2, n3, n4, g1, g2, g3, g4, g5, g6):
    show(f.__name__, f)

# Attributes of built-in objects that have no value yet, or no more.
import pickle, io, struct
pickler = pickle.Pickler(io.BytesIO())
unready = struct.Struct.__new__(struct.Struct)
mark = sentinel("mark")
del mark.__module__
class SubPickler(pickle.Pickler): pass
names.update({id(pickler): 'pickler', id(unready): 'unready', id(mark): 'mark'})
def b1(): pickler.dispatch_table
def b2(): type(pickler).dispatch_table.__get__(pickler)
def b3(): object.__getattribute__(pickler, 'dispatch_table')
def b4(): unready.format
def b5(): unready.format()
def b6(): struct.Struct.format.__get__(unready)
def b7(): mark.__module__
def b8(): type(mark).__dict__['__module__'].__get__(mark)
def b9(): del mark.__module__
for f in (b1, b2, b3, b4, b5, b6, b7, b8, b9):
    show(f.__name__, f)
