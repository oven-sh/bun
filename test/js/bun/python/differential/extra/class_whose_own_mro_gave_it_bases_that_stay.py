# The mro() of a class that is being made assigns to its __bases__. The mro() that this calls puts one of the old bases under the class, and raises: nothing can be taken back, the class keeps the new
# bases, and the first mro() catches the exception and returns. The class is then listed by the bases that it has, once each, and not by those that the class statement named.
# (CPython takes the bases back here, which leaves the old base both above the class and below it: not compared.)
def short(classes): return [c.__name__ for c in classes]
class M(type):
    plan = []
    def mro(cls):
        if M.plan:
            return M.plan.pop(0)(cls)
        return type.mro(cls)

def run(tag, slots):
    G = M('G', (), dict(slots)); First = M('First', (), dict(slots)); Second = M('Second', (), dict(slots))
    log = []
    def outer(cls):
        try:
            cls.__bases__ = (G, First); log.append('assigned')
        except Exception as e:
            log.append('%s: %s' % (type(e).__name__, e))
        return type.mro(cls)
    def nested(cls):
        M.plan.insert(0, lambda other: [other, object])
        try:
            Second.__bases__ = (cls,); log.append('an old base is put under the class')
        except Exception as e:
            log.append('%s: %s' % (type(e).__name__, e)); M.plan.pop(0)
        raise KeyError('the nested mro() raises')
    M.plan[:] = [outer, nested]
    try:
        B = M('B', (First, Second), dict(slots))
    except Exception as e:
        print(tag, '|', log, '| not made: %s: %s' % (type(e).__name__, e)); M.plan[:] = []; return
    M.plan[:] = []
    print(tag, '|', log)
    print('   ', short(B.__bases__), short(B.__mro__), '|', {c.__name__: short(c.__subclasses__()) for c in (G, First, Second)})
    G.w = 1; First.w = 2; print('    told by the bases that it has:', B.w, end=' '); del G.w; print(B.w)

run('without a __dict__', {'__slots__': ()})
run('with a __dict__', {})
