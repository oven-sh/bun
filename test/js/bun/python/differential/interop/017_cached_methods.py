# What an instruction remembers about a class method or a static method must not change what a call of it does: the first call and the later ones are alike.
import js
f = js.eval('(function () { "use strict"; return typeof this + ":" + arguments.length })')
class C:
    cm = classmethod(f)
    sm = staticmethod(f)
class D(C): pass
def cm_of_class(c): return c.cm(1)
def cm_of_instance(o): return o.cm(1)
def sm_of_class(c): return c.sm(1)
def sm_of_instance(o): return o.sm(1)
for function, argument in ((cm_of_class, C), (cm_of_instance, C()), (sm_of_class, C), (sm_of_instance, C()), (cm_of_class, D), (cm_of_instance, D())):
    print(function.__name__, [function(argument) for _ in range(4)])
# A function of Python's takes its place, and the other way round, under instructions that have seen the other.
def p(*a): return "python:" + ",".join(getattr(v, "__name__", str(v)) for v in a)
C.__dict__["cm"].__init__(p)
print([cm_of_class(D) for _ in range(4)], [cm_of_instance(D()) for _ in range(4)])
C.__dict__["cm"].__init__(f)
print([cm_of_class(D) for _ in range(4)], [cm_of_instance(D()) for _ in range(4)])
