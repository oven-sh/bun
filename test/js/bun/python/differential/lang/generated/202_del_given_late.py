# A class that gets a __del__ after instances of it exist; an object that becomes an instance of a class that has one.
try: import gc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import gc')

try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')

try:
    def note(self):
        log.append((type(self).__name__, getattr(self, 'name', None)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def note(self):')

try:
    def show(label):
        gc.collect()
        print(label, sorted(log, key=repr))
        log.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(label):')

try:
    class C:
        def __init__(self, name):
            self.name = name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C:')

try:
    class D(C):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class D(C):')

try:
    class L(list):
        name = 'a list'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class L(list):')

try:
    class E(Exception):
        name = 'an exception'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(Exception):')

try: a, b, d = C('a'), C('b'), D('d')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: a, b, d = C('a'), C('b'), D('d')")
try: C.__del__ = note
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.__del__ = note')
try: del a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del a')
try: show('a dropped:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('a dropped:')")
try: del d
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del d')
try: show('d dropped:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('d dropped:')")
try: c = C('c')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: c = C('c')")
try: del c
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del c')
try: show('made afterwards:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('made afterwards:')")
try: del C.__del__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del C.__del__')
try: del b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del b')
try: show('no __del__ any more:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('no __del__ any more:')")

# Instances of classes derived from built-in types.
try: l, e = L(), E()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l, e = L(), E()')
try: L.__del__ = note
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: L.__del__ = note')
try: E.__del__ = note
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E.__del__ = note')
try: del l, e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del l, e')
try: show('list and exception:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('list and exception:')")

# By way of __bases__.
try:
    class Base:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Base:')
try:
    class WithDel:
        __del__ = note
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithDel:')
try:
    class F(Base):
        name = 'f'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class F(Base):')
try: f = F()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f = F()')
try: F.__bases__ = (WithDel,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: F.__bases__ = (WithDel,)')
try: del f
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del f')
try: show('__bases__:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('__bases__:')")

# By way of __class__.
try:
    class G:
        name = 'g'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class G:')
try:
    class H:
        name = 'h'
        __del__ = note
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class H:')
try: g = G()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = G()')
try: g.__class__ = H
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__class__ = H')
try: del g
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del g')
try: show('__class__:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('__class__:')")

# A class is an instance of its metaclass.
try:
    class M(type):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M(type):')
try:
    class K(metaclass=M):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K(metaclass=M):')
try: M.__del__ = lambda cls: log.append(('class', cls.__name__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: M.__del__ = lambda cls: log.append(('class', cls.__name__))")
try: del K
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del K')
try: show('metaclass:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('metaclass:')")

# Once only.
try:
    class R:
        kept = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R:')
try: r = R()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = R()')
try:
    def resurrect(self):
        log.append('resurrected')
        R.kept.append(self)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def resurrect(self):')
try: R.__del__ = resurrect
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: R.__del__ = resurrect')
try: del r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del r')
try: show('first:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('first:')")
try: R.kept.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: R.kept.clear()')
try: show('second:')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('second:')")
