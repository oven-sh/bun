def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)
def mk(**m):
    return type("X", (), {k: (lambda v: lambda self, *a, **k: v)(v) for k, v in m.items()})()

# __repr__ and __str__
class R:
    def __repr__(s): return "R-repr"
class S:
    def __str__(s): return "S-str"
class RS:
    def __repr__(s): return "RS-repr"
    def __str__(s): return "RS-str"
print(repr(R()), str(R()), str(S()), repr(S())[:14], repr(RS()), str(RS()), [R(), RS()], (RS(),), {RS(): RS()}, {R()}, "%s %r" % (RS(), RS()), "{} {!r} {!s}".format(RS(), RS(), RS()), f"{RS()} {RS()!r} {RS()!s} {RS()!a}", format(RS()), print(RS(), R()), ascii(R()), str([S()])[:15])
t(lambda: repr(mk(__repr__=5))); t(lambda: str(mk(__str__=5))); t(lambda: repr(mk(__repr__=None))); t(lambda: str(mk(__repr__=5))); t(lambda: str(mk(__str__=b"b"))); t(lambda: "%s" % mk(__str__=1)); t(lambda: f"{mk(__str__=1)}"); t(lambda: [mk(__repr__=1)].__repr__()); t(lambda: print(mk(__str__=1))); t(lambda: ascii(mk(__repr__=1))); t(lambda: format(mk(__str__=1)))
class StrSub(str): pass
print(type(str(mk(__str__=StrSub("sub")))).__name__, type(repr(mk(__repr__=StrSub("sub")))).__name__, str(mk(__str__=StrSub("sub"))), ascii(mk(__repr__="é")), repr(mk(__repr__="é\n")), str(StrSub("x")), type(str(StrSub("x"))).__name__, repr(StrSub("x")))
class RaisingRepr:
    def __repr__(s): raise ValueError("repr failed")
t(lambda: repr(RaisingRepr())); t(lambda: str(RaisingRepr())); t(lambda: [RaisingRepr()].__repr__()); t(lambda: "%r" % RaisingRepr()); t(lambda: f"{RaisingRepr()}"); t(lambda: {1: RaisingRepr()}.__repr__())
# __bool__
print(bool(mk(__bool__=True)), bool(mk(__bool__=False)), bool(mk(__len__=0)), bool(mk(__len__=2)), bool(mk(__bool__=True, __len__=0)), bool(mk()), not mk(__bool__=False), mk(__bool__=False) or "or", mk(__bool__=True) and "and", "y" if mk(__bool__=False) else "n", [x for x in [1] if mk(__bool__=False)], all([mk(__bool__=False)]), any([mk(__bool__=True)]), list(filter(None, [mk(__bool__=False)])))
t(lambda: bool(mk(__bool__=1))); t(lambda: bool(mk(__bool__=0))); t(lambda: bool(mk(__bool__=None))); t(lambda: bool(mk(__bool__="x"))); t(lambda: not mk(__bool__=1)); t(lambda: mk(__bool__=1) and 1); t(lambda: 1 if mk(__bool__=[]) else 2)
def wh():
    while mk(__bool__=2): pass
t(wh)
def asrt():
    assert mk(__bool__=2)
t(asrt)
class RaisingBool:
    def __bool__(s): raise ValueError("no truth")
t(lambda: bool(RaisingBool())); t(lambda: RaisingBool() or 1); t(lambda: not RaisingBool()); t(lambda: [1 for _ in [1] if RaisingBool()]); t(lambda: 1 < 2 < 3 and RaisingBool() and 1); t(lambda: any([RaisingBool()]))
# __int__, __index__, __trunc__, __float__, __complex__
print(int(mk(__int__=5)), int(mk(__index__=6)), int(mk(__int__=5, __index__=6)), float(mk(__float__=1.5)), float(mk(__index__=2)), complex(mk(__complex__=1j)), complex(mk(__float__=1.5)), complex(mk(__index__=3)), int(mk(__int__=True)) if False else "", float(mk(__float__=1.5, __index__=2)), int(mk(__int__=10 ** 30)), float(mk(__index__=10 ** 20)))
t(lambda: int(mk(__int__=1.5))); t(lambda: int(mk(__int__="5"))); t(lambda: int(mk(__int__=None))); t(lambda: int(mk(__index__=1.5))); t(lambda: int(mk(__trunc__=5))); t(lambda: int(mk(__float__=1.5))); t(lambda: int(mk())); t(lambda: float(mk(__float__=1))); t(lambda: float(mk(__float__="1.5"))); t(lambda: float(mk(__int__=1))); t(lambda: float(mk())); t(lambda: float(mk(__index__=10 ** 400))); t(lambda: complex(mk(__complex__=1))); t(lambda: complex(mk(__complex__=1.5))); t(lambda: complex(mk(__int__=1))); t(lambda: complex(mk())); t(lambda: int(mk(__int__=5), 10)); t(lambda: int(mk(__int__=True))); t(lambda: int(mk(__index__=True))); t(lambda: [1, 2][mk(__int__=1)])
class FS(float): pass
class IS(int): pass
class CS(complex): pass
t(lambda: (float(mk(__float__=FS(1.5))), type(float(mk(__float__=FS(1.5))))))
t(lambda: (int(mk(__int__=IS(5))), type(int(mk(__int__=IS(5))))))
t(lambda: (complex(mk(__complex__=CS(1j))), type(complex(mk(__complex__=CS(1j))))))
# __round__, __floor__, __ceil__, __trunc__, __abs__, __divmod__
print(round(mk(__round__="rounded")), round(mk(__round__="rounded"), 2), abs(mk(__abs__="abs")), divmod(mk(__divmod__="dm"), 1), divmod(1, mk(__rdivmod__="rdm")), round(mk(__round__=None)))
class Rd:
    def __round__(s, n=None): return ("round", n)
print(round(Rd()), round(Rd(), 1), round(Rd(), None), round(Rd(), ndigits=2), round(number=Rd()))
t(lambda: round(mk())); t(lambda: round("a")); t(lambda: round(None)); t(lambda: round([])); t(lambda: abs(mk())); t(lambda: abs("a")); t(lambda: abs(None)); t(lambda: abs([])); t(lambda: round()); t(lambda: round(1, 2, 3)); t(lambda: round(1.5, "a")); t(lambda: round(1, 1.5)); t(lambda: abs()); t(lambda: abs(1, 2)); t(lambda: divmod(1)); t(lambda: divmod("a", 1)); t(lambda: divmod(1, "a")); t(lambda: divmod(mk(), 1))
# __format__
class F:
    def __format__(s, spec): return "F<%s>" % spec
print(format(F()), format(F(), "x"), "{}".format(F()), "{:abc}".format(F()), f"{F()}", f"{F():>10}", f"{F()!s:.3}", "{!r:.3}".format(F()), "%s" % F() != "F<>")
t(lambda: format(mk(__format__=5))); t(lambda: format(mk(__format__=None))); t(lambda: f"{mk(__format__=5)}"); t(lambda: format(mk(), "x")); t(lambda: format(mk(), "")[:3]); t(lambda: format()); t(lambda: format(1, 2, 3)); t(lambda: format(1, 1)); t(lambda: object.__format__(1, "x")); t(lambda: object.__format__(1, 1)); t(lambda: format(None, "x")); t(lambda: format([], ">5")); t(lambda: format(type, "x")); t(lambda: format(len, "x")); t(lambda: format(..., "5")); t(lambda: format((1,), "5")); t(lambda: format({}, "5")); t(lambda: format(range(1), "5")); t(lambda: format(b"a", "5")); t(lambda: format(object(), "s"))
# __bytes__, __fspath__, __hash__, __sizeof__, __call__
print(bytes(mk(__bytes__=b"x")), hash(mk(__hash__=5)), mk(__call__="called")(), mk(__call__="called")(1, a=2), callable(mk(__call__=1)), callable(mk()), callable(type("C", (), {"__call__": None})()), callable(int), callable(len), callable(lambda: 0), callable("a"), callable(None), callable([].append), callable(type), callable(mk), callable(staticmethod(len)), callable(classmethod(len)), callable(property()))
t(lambda: bytes(mk(__bytes__="x"))); t(lambda: bytes(mk(__bytes__=5))); t(lambda: bytes(mk(__bytes__=None))); t(lambda: bytes(mk())); t(lambda: mk()()); t(lambda: type("C", (), {"__call__": None})()()); t(lambda: type("C", (), {"__call__": 5})()()); t(lambda: compile("1", mk(__fspath__=5), "eval")); t(lambda: compile("1", mk(), "eval")); print(compile("1", mk(__fspath__="path"), "eval").co_filename, compile("1", mk(__fspath__=b"bpath"), "eval").co_filename, compile("1", b"bytes", "eval").co_filename)
class Call:
    def __call__(s, *a, **k): return (a, k)
c = Call(); print(c(), c(1), c(1, x=2), c(*[1, 2], **{"y": 3}), c.__call__(5), Call.__call__(c, 6), list(map(c, [1, 2])), sorted([2, 1], key=lambda v: c(v)[0]), type(c.__call__).__name__, c.__call__.__call__.__call__(7))
class CallChain:
    def __call__(s): return s
print(type(CallChain()()()()).__name__)
class CallDesc:
    __call__ = Call()
print(CallDesc()(1))
class CallType:
    __call__ = int
print(CallType()("5"), CallType()())
class CallLen:
    __call__ = len
print(CallLen()([1, 2]))
# __enter__/__exit__, __await__, __aiter__ are elsewhere. __contains__, __iter__ too.
# str(), repr(), int()... on types themselves use the metaclass.
class WithAll:
    def __repr__(s): return "inst"
    def __len__(s): return 1
    def __int__(s): return 1
    def __bool__(s): return False
    def __hash__(s): return 1
    def __call__(s): return "inst call"
    def __iter__(s): return iter(())
print(repr(WithAll)[:8], bool(WithAll), isinstance(hash(WithAll), int), type(WithAll()).__name__); t(lambda: len(WithAll)); t(lambda: int(WithAll)); t(lambda: iter(WithAll)); t(lambda: WithAll.__len__()); t(lambda: WithAll.__repr__()); print(WithAll.__repr__(WithAll()), WithAll.__len__(WithAll()), type.__repr__(WithAll)[:8])
