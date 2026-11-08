# Which class decides the layout of the instances of a class that assignments to __bases__ from inside one another have left out of the list of its base, when that base is given another base.
class Hooked(type):
    plan = {}
    def mro(cls):
        act = Hooked.plan.pop(cls.__name__, None)
        if act: act()
        return type.mro(cls)
def short(cs): return [c.__name__ for c in cs]
def assign(c, bases):
    try: c.__bases__ = bases; return 'assigned'
    except Exception as e: return '%s: %s' % (type(e).__name__, e)
def attempt(f):
    try: return f().__name__
    except Exception as e: return '%s: %s' % (type(e).__name__, e)
def then(*acts):
    def act():
        for a in acts: a()
    return act
def fail(): raise KeyError('fails')
class S1(metaclass=Hooked): __slots__ = ('a',)
class S2(metaclass=Hooked): __slots__ = ('a',)
class B(S1): pass
class G1(S1): pass
class A(B): pass
class S(A): pass
def inside(bases, *after): return then(lambda: print('  from inside,', short(bases), assign(A, bases)), *after)
others = (G1,)
Hooked.plan['S'] = then(lambda: Hooked.plan.__setitem__('S', inside(others)), inside((B,)), fail)
print(assign(A, others))
for c in (A, B, G1, S): print(' ', c.__name__, short(c.__bases__), short(c.__mro__), short(c.__subclasses__()))
print(assign(B, (S2,)))
for c in (A, B, G1, S): print(' ', c.__name__, short(c.__bases__), short(c.__mro__), short(c.__subclasses__()))
print('Z(A, S2):', attempt(lambda: Hooked('Z', (A, S2), {})))
print('Y(A, S1):', attempt(lambda: Hooked('Y', (A, S1), {})))
print('Z(S, S2):', attempt(lambda: Hooked('Z', (S, S2), {})))
print('Y(S, S1):', attempt(lambda: Hooked('Y', (S, S1), {})))
