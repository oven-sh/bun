# A class that gets a __del__ after instances of it exist; an object that becomes an instance of a class that has one.
import gc

log = []

def note(self):
    log.append((type(self).__name__, getattr(self, 'name', None)))

def show(label):
    gc.collect()
    print(label, sorted(log, key=repr))
    log.clear()

class C:
    def __init__(self, name):
        self.name = name

class D(C):
    pass

class L(list):
    name = 'a list'

class E(Exception):
    name = 'an exception'

a, b, d = C('a'), C('b'), D('d')
C.__del__ = note
del a
show('a dropped:')
del d
show('d dropped:')
c = C('c')
del c
show('made afterwards:')
del C.__del__
del b
show('no __del__ any more:')

# Instances of classes derived from built-in types.
l, e = L(), E()
L.__del__ = note
E.__del__ = note
del l, e
show('list and exception:')

# By way of __bases__.
class Base:
    pass
class WithDel:
    __del__ = note
class F(Base):
    name = 'f'
f = F()
F.__bases__ = (WithDel,)
del f
show('__bases__:')

# By way of __class__.
class G:
    name = 'g'
class H:
    name = 'h'
    __del__ = note
g = G()
g.__class__ = H
del g
show('__class__:')

# A class is an instance of its metaclass.
class M(type):
    pass
class K(metaclass=M):
    pass
M.__del__ = lambda cls: log.append(('class', cls.__name__))
del K
show('metaclass:')

# Once only.
class R:
    kept = []
r = R()
def resurrect(self):
    log.append('resurrected')
    R.kept.append(self)
R.__del__ = resurrect
del r
show('first:')
R.kept.clear()
show('second:')
