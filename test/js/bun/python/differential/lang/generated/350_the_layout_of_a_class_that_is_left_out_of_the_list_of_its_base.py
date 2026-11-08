# Which class decides the layout of the instances of a class that assignments to __bases__ from inside one another have left out of the list of its base, when that base is given another base.
try:
    class Hooked(type):
        plan = {}
        def mro(cls):
            act = Hooked.plan.pop(cls.__name__, None)
            if act: act()
            return type.mro(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Hooked(type):')
try:
    def short(cs): return [c.__name__ for c in cs]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def short(cs): return [c.__name__ for c in cs]')
try:
    def assign(c, bases):
        try: c.__bases__ = bases; return 'assigned'
        except Exception as e: return '%s: %s' % (type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def assign(c, bases):')
try:
    def attempt(f):
        try: return f().__name__
        except Exception as e: return '%s: %s' % (type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def attempt(f):')
try:
    def then(*acts):
        def act():
            for a in acts: a()
        return act
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def then(*acts):')
try:
    def fail(): raise KeyError('fails')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def fail(): raise KeyError('fails')")
try:
    class S1(metaclass=Hooked): __slots__ = ('a',)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class S1(metaclass=Hooked): __slots__ = ('a',)")
try:
    class S2(metaclass=Hooked): __slots__ = ('a',)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class S2(metaclass=Hooked): __slots__ = ('a',)")
try:
    class B(S1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class B(S1): pass')
try:
    class G1(S1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class G1(S1): pass')
try:
    class A(B): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A(B): pass')
try:
    class S(A): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S(A): pass')
try:
    def inside(bases, *after): return then(lambda: print('  from inside,', short(bases), assign(A, bases)), *after)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def inside(bases, *after): return then(lambda: print(' from inside,',...")
try: others = (G1,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: others = (G1,)')
try: Hooked.plan['S'] = then(lambda: Hooked.plan.__setitem__('S', inside(others)), inside((B,)), fail)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Hooked.plan['S'] = then(lambda: Hooked.plan.__setitem__('S', inside(o...")
try: print(assign(A, others))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(A, others)')
try:
    for c in (A, B, G1, S): print(' ', c.__name__, short(c.__bases__), short(c.__mro__), short(c.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for c in (A, B, G1, S): print(' ', c.__name__, short(c.__bases__), sh...")
try: print(assign(B, (S2,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(B, (S2,))')
try:
    for c in (A, B, G1, S): print(' ', c.__name__, short(c.__bases__), short(c.__mro__), short(c.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for c in (A, B, G1, S): print(' ', c.__name__, short(c.__bases__), sh...")
try: print('Z(A, S2):', "attempt(lambda: Hooked('Z', (A, S2), {})) =>", attempt(lambda: Hooked('Z', (A, S2), {})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt(lambda: Hooked('Z', (A, S2), {}))")
try: print('Y(A, S1):', "attempt(lambda: Hooked('Y', (A, S1), {})) =>", attempt(lambda: Hooked('Y', (A, S1), {})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt(lambda: Hooked('Y', (A, S1), {}))")
try: print('Z(S, S2):', "attempt(lambda: Hooked('Z', (S, S2), {})) =>", attempt(lambda: Hooked('Z', (S, S2), {})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt(lambda: Hooked('Z', (S, S2), {}))")
try: print('Y(S, S1):', "attempt(lambda: Hooked('Y', (S, S1), {})) =>", attempt(lambda: Hooked('Y', (S, S1), {})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: attempt(lambda: Hooked('Y', (S, S1), {}))")
