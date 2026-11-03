# The warnings about __complex__ and __float__ that return an instance of a subclass.
import cmath, math, warnings

def show(module, name, *args, **kw):
    try:
        r = getattr(module, name)(*args, **kw)
        r = '%s %r' % (type(r).__name__, r)
    except Exception as e:
        r = '%s: %s' % (type(e).__name__, e)
    print(name, args, kw or '', r)

class Cx:
    def __init__(self, v): self.v = v
    def __complex__(self): return self.v
    def __repr__(self): return 'Cx(%r)' % (self.v,)
class Fl:
    def __init__(self, v): self.v = v
    def __float__(self): return self.v
    def __repr__(self): return 'Fl(%r)' % (self.v,)
class C(complex):
    pass
class F(float):
    pass

with warnings.catch_warnings(record=True) as caught:
    warnings.simplefilter('always')
    show(cmath, 'sqrt', Cx(C(4)))
    show(cmath, 'sqrt', Fl(F(4.0)))
    show(math, 'sqrt', Fl(F(4.0)))
    for w in caught:
        print(w.category.__name__, w.message)
with warnings.catch_warnings():
    warnings.simplefilter('error')
    show(cmath, 'sqrt', Cx(C(4)))
    show(cmath, 'sqrt', Fl(F(4.0)))
    show(math, 'sqrt', Fl(F(4.0)))
