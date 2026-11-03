def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

def f(a, b=2, *args, c, d=4, **kw):
    "doc of f"
    x = 1; y = 2
    return x
print(f.__name__, f.__qualname__, f.__doc__, f.__module__, f.__defaults__, f.__kwdefaults__, f.__dict__, f.__closure__, f.__globals__ is globals(), f.__annotations__, f.__type_params__, type(f).__name__, f.__builtins__ is __builtins__.__dict__)
c = f.__code__
print(c.co_name, c.co_qualname, c.co_argcount, c.co_posonlyargcount, c.co_kwonlyargcount, c.co_nlocals, c.co_varnames, c.co_freevars, c.co_cellvars, c.co_flags & 0xff, c.co_firstlineno, c.co_filename.endswith("032_function_attributes.py"), type(c).__name__, c.co_consts[0] if c.co_flags & 0x4000000 else None)
def g(a, /, b, *, c): pass
print(g.__code__.co_argcount, g.__code__.co_posonlyargcount, g.__code__.co_kwonlyargcount, g.__code__.co_varnames, g.__code__.co_flags & 0xff, g.__defaults__, g.__kwdefaults__, g.__doc__)
def gen(): yield
async def co(): pass
async def ag(): yield
print(gen.__code__.co_flags & 0x3ff, co.__code__.co_flags & 0x3ff, ag.__code__.co_flags & 0x3ff, (lambda: 0).__code__.co_flags & 0x3ff, (lambda *a: 0).__code__.co_flags & 0x3ff, (lambda **k: 0).__code__.co_flags & 0x3ff)
def outer(p):
    q = 1; unused = 2
    def inner(r):
        s = p + q
        return s + r
    return inner
i = outer(10)
print(i.__name__, i.__qualname__, i.__code__.co_freevars, i.__code__.co_varnames, i.__code__.co_cellvars, outer.__code__.co_cellvars, outer.__code__.co_varnames, outer.__code__.co_freevars, len(i.__closure__), [c.cell_contents for c in i.__closure__], type(i.__closure__[0]).__name__, i(1), outer.__code__.co_nlocals, i.__code__.co_flags & 0xff)
i.__closure__[0].cell_contents = 100; print(i(1))
class K:
    def m(self): pass
    class N:
        def nm(self): pass
    def mk(self):
        def loc(): pass
        return loc
    lam = lambda self: 0
print(K.m.__qualname__, K.N.nm.__qualname__, K().mk().__qualname__, K.lam.__qualname__, K.lam.__name__, K.N.__qualname__, K.m.__name__, K().m.__qualname__, K().m.__name__, K.m.__module__)
print((lambda: 0).__name__, (lambda: 0).__qualname__, [lambda: 0][0].__qualname__, (lambda: (lambda: 0))().__qualname__)
def genexp_names(): return (x for x in []).__qualname__, (x for x in []).__name__, (x for x in []).gi_code.co_name
print(genexp_names())
f.__name__ = "renamed"; f.__qualname__ = "q.renamed"; f.__doc__ = "new doc"; f.__module__ = "mod"; print(f.__name__, f.__qualname__, f.__doc__, f.__module__, f.__code__.co_name, repr(f)[:20])
f.__doc__ = None; print(f.__doc__); f.__doc__ = 5; print(f.__doc__); del f.__doc__; print(f.__doc__)
f.attr = 1; f.other = [2]; print(f.attr, f.__dict__, hasattr(f, "attr"), hasattr(f, "nope"), vars(f)); del f.attr; print(f.__dict__); f.__dict__["via"] = 3; print(f.via); f.__dict__ = {"z": 26}; print(f.z, f.__dict__)
t(lambda: f.nope)
def s1(): f.__name__ = 1
def s2(): f.__qualname__ = None
def s3(): f.__defaults__ = [1]
def s4(): f.__kwdefaults__ = [1]
def s5(): f.__dict__ = 1
def s6(): f.__closure__ = ()
def s7(): f.__globals__ = {}
def s8(): del f.__name__
def s9(): del f.__dict__
def s10(): f.__code__ = 1
def s11(): f.__annotations__ = 1
def s12(): f.__type_params__ = 1
def s13(): f.__builtins__ = {}
def s14(): del f.nope
for s in (s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14): t(s)
def d(a, b=1, c=2): return a, b, c
print(d(0)); d.__defaults__ = (10, 20); print(d(0)); d.__defaults__ = (5,); print(d(0, 1)); t(lambda: d(0)); d.__defaults__ = (7, 8, 9); print(d()); d.__defaults__ = None; t(lambda: d(0)); del d.__defaults__; print(d.__defaults__); d.__defaults__ = (1, 2, 3, 4, 5); print(d())
def kd(*, a=1, b): return a, b
print(kd(b=2)); kd.__kwdefaults__ = {"b": 5}; t(lambda: kd()); print(kd(a=0)); kd.__kwdefaults__ = {"a": 1, "b": 2, "zzz": 3}; print(kd()); kd.__kwdefaults__ = None; t(lambda: kd()); kd.__kwdefaults__ = {}; t(lambda: kd(a=1))
md = d.__defaults__
def mut(x=[]): x.append(1); return x
mut(); mut(); print(mut.__defaults__, mut.__defaults__[0] is mut())
print(f == f, f != f, f == g, f is f, hash(f) == hash(f), bool(f), callable(f), isinstance(f, type(g)), {f: 1}[f], f in [f], sorted([f.__name__, g.__name__]))
t(lambda: f < g)
t(lambda: f + g)
t(lambda: f[0])
t(lambda: len(f))
t(lambda: iter(f))
FunctionType = type(f); CodeType = type(f.__code__); CellType = type(i.__closure__[0])
def tmpl(a, b=1): return a + b + glob
n = FunctionType(tmpl.__code__, {"glob": 100}); print(n(1, 1), n.__name__, n.__defaults__, n.__globals__["glob"], n.__qualname__)
t(lambda: n(1))
n = FunctionType(tmpl.__code__, {"glob": 5}, "newname", (10,)); print(n(1), n.__name__, n.__qualname__, n.__defaults__)
n = FunctionType(i.__code__, {}, None, None, (CellType(1), CellType(2))); print(n(3))
n = FunctionType(tmpl.__code__, {"glob": 0}, kwdefaults={"z": 1}); print(n.__kwdefaults__)
t(lambda: FunctionType(i.__code__, {}))
t(lambda: FunctionType(i.__code__, {}, None, None, (1, 2)))
t(lambda: FunctionType(i.__code__, {}, None, None, (CellType(1),)))
t(lambda: FunctionType(tmpl.__code__, {}, None, None, (CellType(1),)))
t(lambda: FunctionType(1, {}))
t(lambda: FunctionType(tmpl.__code__, 1))
t(lambda: FunctionType(tmpl.__code__, {}, 1))
t(lambda: FunctionType(tmpl.__code__, {}, None, [1]))
t(lambda: FunctionType())
ce = CellType(); print(repr(ce)[:9], repr(ce).endswith("empty>")); t(lambda: ce.cell_contents); ce.cell_contents = 5; print(ce.cell_contents, CellType(1) == CellType(1), CellType(1) < CellType(2), CellType() == CellType(), CellType() < CellType(1), CellType(1) != CellType(2)); del ce.cell_contents; t(lambda: ce.cell_contents)
t(lambda: hash(CellType(1)))
t(lambda: CellType(1, 2))
t(lambda: CellType(1) < 1)
# Bound methods.
class M:
    def meth(self, x=1): "mdoc"; return self, x
o = M(); b = o.meth
print(b.__self__ is o, b.__func__ is M.meth, b.__name__, b.__qualname__, b.__doc__, b.__module__, b.__defaults__, b.__code__ is M.meth.__code__, type(b).__name__, b() == (o, 1), b == o.meth, b is o.meth, hash(b) == hash(o.meth), b != M().meth, callable(b), b.__call__(2)[1], b.__func__(o, 3)[1])
M.meth.tag = "t"; print(b.tag)
def sb1(): b.tag = 1
def sb2(): b.__self__ = 1
def sb3(): b.__func__ = 1
def sb4(): b.newattr = 1
t(sb1); t(sb2); t(sb3); t(sb4); t(lambda: b.nope)
MethodType = type(b); mm = MethodType(lambda s, a: (s, a), "SELF"); print(mm(1), mm.__self__, MethodType(len, [1, 2])(), MethodType(mm, "x") .__self__)
t(lambda: MethodType(1, 2)); t(lambda: MethodType(len, None)); t(lambda: MethodType(len)); t(lambda: MethodType(lambda: 0, 1)())
# Built-in functions.
print(len.__name__, len.__qualname__, len.__module__, len.__self__.__name__, type(len).__name__, [].append.__name__, [].append.__qualname__, type([].append).__name__, [1].append.__self__, len.__doc__ is not None or True, repr(len), repr(print), len == len, hash(len) == hash(len), callable(len), [].append == [].append, (l := []).append == l.append, len.__text_signature__, type(str.upper).__name__, type(int.__add__).__name__, type((1).__add__).__name__, type(dict.fromkeys).__name__, type(dict.__dict__["fromkeys"]).__name__, type(str.maketrans).__name__, type(str.__dict__["maketrans"]).__name__, repr(str.upper), repr(int.__add__), repr(dict.__dict__["fromkeys"]), int.__add__.__name__, int.__add__.__objclass__, (1).__add__.__self__, (1).__add__.__name__, int.__new__.__name__, int.__new__.__self__, type(int.__new__).__name__, type(int.real).__name__, repr(int.real), int.real.__name__, int.real.__objclass__)
def sl(): len.x = 1
t(sl); t(lambda: len.__dict__); t(lambda: len.__code__); t(lambda: len.__defaults__); t(lambda: len.__globals__); t(lambda: len.nope)
