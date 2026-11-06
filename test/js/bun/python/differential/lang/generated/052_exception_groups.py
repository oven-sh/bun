try:
    def t(f):
        try:
            print(repr(f()))
        except BaseException as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')
try:
    def show(g, indent=0):
        if isinstance(g, BaseExceptionGroup):
            return "%s(%r, [%s])" % (type(g).__name__, g.message, ", ".join(show(e) for e in g.exceptions))
        return repr(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(g, indent=0):')

try: g = ExceptionGroup("msg", [ValueError(1), TypeError(2)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = ExceptionGroup("msg", [ValueError(1), TypeError(2)])')
try: print('repr(g) =>', repr(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(g)')
try: print("|", 'str(g) =>', str(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: str(g)')
try: print("|", 'g.message =>', g.message)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.message')
try: print('g.exceptions =>', g.exceptions)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.exceptions')
try: print('g.args =>', g.args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.args')
try: print('type(g) =>', type(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(g)')
try: print('isinstance(g, Exception) =>', isinstance(g, Exception))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(g, Exception)')
try: print('isinstance(g, BaseExceptionGroup) =>', isinstance(g, BaseExceptionGroup))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(g, BaseExceptionGroup)')
try: print('ExceptionGroup.__mro__ =>', ExceptionGroup.__mro__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ExceptionGroup.__mro__')
try: print('len(g.exceptions) =>', len(g.exceptions))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(g.exceptions)')
try: print('type(g.exceptions) =>', type(g.exceptions))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(g.exceptions)')
try: print('str(ExceptionGroup("one", [ValueError()])) =>', str(ExceptionGroup("one", [ValueError()])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: str(ExceptionGroup("one", [ValueError()]))')
try: print("|", 'str(ExceptionGroup("", [ValueError(), KeyError(), TypeError()])) =>', str(ExceptionGroup("", [ValueError(), KeyError(), TypeError()])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: str(ExceptionGroup("", [ValueError(), KeyError(), TypeError()]))')
try: print("|", 'repr(ExceptionGroup("n", [ExceptionGroup("i", [ValueError(1)])])) =>', repr(ExceptionGroup("n", [ExceptionGroup("i", [ValueError(1)])])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(ExceptionGroup("n", [ExceptionGroup("i", [ValueError(1)])]))')
try: print("|", 'repr(BaseExceptionGroup("b", [KeyboardInterrupt()])) =>', repr(BaseExceptionGroup("b", [KeyboardInterrupt()])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(BaseExceptionGroup("b", [KeyboardInterrupt()]))')
try: print('type(BaseExceptionGroup("b", [ValueError()])).__name__ =>', type(BaseExceptionGroup("b", [ValueError()])).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(BaseExceptionGroup("b", [ValueError()])).__name__')
try: print('type(BaseExceptionGroup("b", [KeyboardInterrupt()])).__name__ =>', type(BaseExceptionGroup("b", [KeyboardInterrupt()])).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(BaseExceptionGroup("b", [KeyboardInterrupt()])).__name__')
try: print('type(BaseExceptionGroup("b", [ValueError(), SystemExit()])).__name__ =>', type(BaseExceptionGroup("b", [ValueError(), SystemExit()])).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(BaseExceptionGroup("b", [ValueError(), SystemExit()])).__name__')
try: print('type(BaseExceptionGroup("b", (ValueError(),))).__name__ =>', type(BaseExceptionGroup("b", (ValueError(),))).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(BaseExceptionGroup("b", (ValueError(),))).__name__')
try: print('ExceptionGroup("t", (ValueError(1),)).exceptions =>', ExceptionGroup("t", (ValueError(1),)).exceptions)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ExceptionGroup("t", (ValueError(1),)).exceptions')
try: print('ExceptionGroup("t", iter([ValueError(1)])).exceptions if False else "" =>', ExceptionGroup("t", iter([ValueError(1)])).exceptions if False else "")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ExceptionGroup("t", iter([ValueError(1)])).exceptions if False else ""')
try: print('ExceptionGroup() =>', end=" "); t(lambda: ExceptionGroup())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup())')
try: print('ExceptionGroup("m") =>', end=" "); t(lambda: ExceptionGroup("m"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup("m"))')
try: print('ExceptionGroup("m", []) =>', end=" "); t(lambda: ExceptionGroup("m", []))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup("m", []))')
try: print('ExceptionGroup("m", ()) =>', end=" "); t(lambda: ExceptionGroup("m", ()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup("m", ()))')
try: print('ExceptionGroup("m", [1]) =>', end=" "); t(lambda: ExceptionGroup("m", [1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup("m", [1]))')
try: print('ExceptionGroup("m", [ValueError(), 1]) =>', end=" "); t(lambda: ExceptionGroup("m", [ValueError(), 1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup("m", [ValueError(), 1]))')
try: print('ExceptionGroup("m", [ValueError]) =>', end=" "); t(lambda: ExceptionGroup("m", [ValueError]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup("m", [ValueError]))')
try: print('ExceptionGroup("m", ValueError()) =>', end=" "); t(lambda: ExceptionGroup("m", ValueError()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup("m", ValueError()))')
try: print('ExceptionGroup("m", 1) =>', end=" "); t(lambda: ExceptionGroup("m", 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup("m", 1))')
try: print('ExceptionGroup(1, [ValueError()]) =>', end=" "); t(lambda: ExceptionGroup(1, [ValueError()]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup(1, [ValueError()]))')
try: print('ExceptionGroup(None, [ValueError()]) =>', end=" "); t(lambda: ExceptionGroup(None, [ValueError()]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup(None, [ValueError()]))')
try: print('ExceptionGroup("m", [KeyboardInterrupt()]) =>', end=" "); t(lambda: ExceptionGroup("m", [KeyboardInterrupt()]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup("m", [KeyboardInterrupt()]))')
try: print('ExceptionGroup("m", [ValueError(), SystemExit()]) =>', end=" "); t(lambda: ExceptionGroup("m", [ValueError(), SystemExit()]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup("m", [ValueError(), SystemExit()]))')
try: print('ExceptionGroup("m", [BaseExceptionGroup("b", [KeyboardInterrupt()])]) =>', end=" "); t(lambda: ExceptionGroup("m", [BaseExceptionGroup("b", [KeyboardInterrupt()])]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup("m", [BaseExceptionGroup("b", [KeyboardInter...')
try: print('ExceptionGroup("m", [ValueError()], 1) =>', end=" "); t(lambda: ExceptionGroup("m", [ValueError()], 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup("m", [ValueError()], 1))')
try: print('ExceptionGroup("m", "ab") =>', end=" "); t(lambda: ExceptionGroup("m", "ab"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup("m", "ab"))')
try: print('ExceptionGroup("m", {ValueError()}) =>', end=" "); t(lambda: ExceptionGroup("m", {ValueError()}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup("m", {ValueError()}))')
try: print('ExceptionGroup("m", None) =>', end=" "); t(lambda: ExceptionGroup("m", None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup("m", None))')
try: print('ExceptionGroup(message="m", exceptions=[ValueError()]) =>', end=" "); t(lambda: ExceptionGroup(message="m", exceptions=[ValueError()]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExceptionGroup(message="m", exceptions=[ValueError()]))')
try: print('BaseExceptionGroup("m", []) =>', end=" "); t(lambda: BaseExceptionGroup("m", []))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: BaseExceptionGroup("m", []))')
try:
    def s1(): g.message = "x"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s1(): g.message = "x"')
try:
    def s2(): g.exceptions = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s2(): g.exceptions = ()')
try: print('s1() =>', end=" "); t(s1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s1)')
try: print('s2() =>', end=" "); t(s2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s2)')
try: l = [ValueError(1)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l = [ValueError(1)]')
try: gl = ExceptionGroup("l", l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gl = ExceptionGroup("l", l)')
try: l.append(TypeError(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l.append(TypeError(2))')
try: print('gl.exceptions =>', gl.exceptions)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gl.exceptions')
try: print('gl.args =>', gl.args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gl.args')
# subgroup and split
try: n = ExceptionGroup("top", [ValueError("v1"), ExceptionGroup("mid", [TypeError("t1"), ValueError("v2"), ExceptionGroup("low", [KeyError("k1")])]), OSError("o1")])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n = ExceptionGroup("top", [ValueError("v1"), ExceptionGroup("mid", [T...')
try: print(show(n.subgroup(ValueError)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(n.subgroup(ValueError))')
try: print(show(n.subgroup(TypeError)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(n.subgroup(TypeError))')
try: print(show(n.subgroup(KeyError)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(n.subgroup(KeyError))')
try: print(show(n.subgroup((ValueError, KeyError))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(n.subgroup((ValueError, KeyError)))')
try: print(n.subgroup(ZeroDivisionError))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.subgroup(ZeroDivisionError)')
try: print('n.subgroup(Exception) is n =>', n.subgroup(Exception) is n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.subgroup(Exception) is n')
try: print('n.subgroup(ExceptionGroup) is n =>', n.subgroup(ExceptionGroup) is n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.subgroup(ExceptionGroup) is n')
try: print('show(n.subgroup(LookupError)) =>', show(n.subgroup(LookupError)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(n.subgroup(LookupError))')
try: print('show(n.subgroup(lambda e: isinstance(e, OSError))) =>', show(n.subgroup(lambda e: isinstance(e, OSError))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(n.subgroup(lambda e: isinstance(e, OSError)))')
try: print('n.subgroup(lambda e: False) =>', n.subgroup(lambda e: False))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.subgroup(lambda e: False)')
try: print('n.subgroup(lambda e: True) is n =>', n.subgroup(lambda e: True) is n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.subgroup(lambda e: True) is n')
try: print('show(n.subgroup(lambda e: str(e).endswith("1") and not isinstance(e, ... =>', show(n.subgroup(lambda e: str(e).endswith("1") and not isinstance(e, BaseExceptionGroup))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(n.subgroup(lambda e: str(e).endswith("1") and not isinstance(e, ...')
try:
    for cond in (ValueError, (TypeError, OSError), ZeroDivisionError, Exception, lambda e: isinstance(e, KeyError)):
        try: m, r = n.split(cond)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m, r = n.split(cond)')
        try: print('show(m) [' + 'cond=' + (repr(cond) if type(cond) in (str, int, float, bytes, bool, type(None)) or (type(cond) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cond)) else cond.__name__ if type(cond) is type else type(cond).__name__) + '] =>', show(m))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(m)')
        try: print("||", 'show(r) [' + 'cond=' + (repr(cond) if type(cond) in (str, int, float, bytes, bool, type(None)) or (type(cond) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in cond)) else cond.__name__ if type(cond) is type else type(cond).__name__) + '] =>', show(r))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(r)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for cond in (ValueError, (TypeError, OSError), ZeroDivisionError, Exc...')
try: seen = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen = []')
try: n.subgroup(lambda e: seen.append(type(e).__name__) or False)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.subgroup(lambda e: seen.append(type(e).__name__) or False)')
try: print(seen)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen')
try: print('n.subgroup(1) =>', end=" "); t(lambda: n.subgroup(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n.subgroup(1))')
try: print('n.subgroup("a") =>', end=" "); t(lambda: n.subgroup("a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n.subgroup("a"))')
try: print('n.subgroup(int) =>', end=" "); t(lambda: n.subgroup(int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n.subgroup(int))')
try: print('n.subgroup((ValueError, 1)) =>', end=" "); t(lambda: n.subgroup((ValueError, 1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n.subgroup((ValueError, 1)))')
try: print('n.subgroup(()) =>', end=" "); t(lambda: n.subgroup(()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n.subgroup(()))')
try: print('n.subgroup([ValueError]) =>', end=" "); t(lambda: n.subgroup([ValueError]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n.subgroup([ValueError]))')
try: print('n.split(None) =>', end=" "); t(lambda: n.split(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n.split(None))')
try: print('n.subgroup() =>', end=" "); t(lambda: n.subgroup())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n.subgroup())')
try: print('n.split(ValueError, 1) =>', end=" "); t(lambda: n.split(ValueError, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n.split(ValueError, 1))')
try: print('n.subgroup((int,)) =>', end=" "); t(lambda: n.subgroup((int,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n.subgroup((int,)))')
try: print('n.subgroup(object) =>', end=" "); t(lambda: n.subgroup(object))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: n.subgroup(object))')
# Metadata is copied to the parts.
try:
    try:
        try: raise KeyError("ctx")
        except KeyError: raise ExceptionGroup("meta", [ValueError(1), TypeError(2)]) from OSError("cause")
    except ExceptionGroup as e: meta = e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: meta.add_note("a note")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: meta.add_note("a note")')
try: sub = meta.subgroup(ValueError)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sub = meta.subgroup(ValueError)')
try: print('sub.__traceback__ is meta.__traceback__ =>', sub.__traceback__ is meta.__traceback__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sub.__traceback__ is meta.__traceback__')
try: print('repr(sub.__cause__) =>', repr(sub.__cause__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(sub.__cause__)')
try: print('repr(sub.__context__) =>', repr(sub.__context__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(sub.__context__)')
try: print('sub.__notes__ =>', sub.__notes__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sub.__notes__')
try: print('sub.__notes__ is meta.__notes__ =>', sub.__notes__ is meta.__notes__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sub.__notes__ is meta.__notes__')
try: print('sub.message =>', sub.message)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sub.message')
try: print('sub.exceptions[0] is meta.exceptions[0] =>', sub.exceptions[0] is meta.exceptions[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sub.exceptions[0] is meta.exceptions[0]')
try: print('sub.__suppress_context__ =>', sub.__suppress_context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sub.__suppress_context__')
# derive
try: d = g.derive([KeyError("k")])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = g.derive([KeyError("k")])')
try: print('show(d) =>', show(d))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(d)')
try: print('type(d).__name__ =>', type(d).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(d).__name__')
try: print('d.message =>', d.message)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.message')
try: print('d.__traceback__ =>', d.__traceback__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.__traceback__')
try: print('d.__cause__ =>', d.__cause__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.__cause__')
try: print('hasattr(d, "__notes__") =>', hasattr(d, "__notes__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(d, "__notes__")')
try: print('type(g.derive([KeyboardInterrupt()])).__name__ =>', type(g.derive([KeyboardInterrupt()])).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(g.derive([KeyboardInterrupt()])).__name__')
try: print('type(BaseExceptionGroup("b", [SystemExit()]).derive([ValueError()])).... =>', type(BaseExceptionGroup("b", [SystemExit()]).derive([ValueError()])).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(BaseExceptionGroup("b", [SystemExit()]).derive([ValueError()]))....')
try:
    class MyGroup(ExceptionGroup):
        def __new__(cls, msg, excs, code=0):
            o = super().__new__(cls, msg, excs); o.code = code; return o
        def derive(self, excs): return MyGroup(self.message, excs, self.code)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class MyGroup(ExceptionGroup):')
try:
    class NoDerive(ExceptionGroup): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoDerive(ExceptionGroup): pass')
try: mg = MyGroup("my", [ValueError(1), TypeError(2)], 42)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mg = MyGroup("my", [ValueError(1), TypeError(2)], 42)')
try: a, b = mg.split(ValueError)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a, b = mg.split(ValueError)')
try: print('type(a).__name__ =>', type(a).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(a).__name__')
try: print('a.code =>', a.code)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.code')
try: print('type(b).__name__ =>', type(b).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(b).__name__')
try: print('b.code =>', b.code)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b.code')
try: print('show(a) =>', show(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(a)')
try: print('repr(mg) =>', repr(mg))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(mg)')
try: print('mg.args =>', mg.args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mg.args')
try: nd = NoDerive("nd", [ValueError(1), TypeError(2)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nd = NoDerive("nd", [ValueError(1), TypeError(2)])')
try: a, b = nd.split(ValueError)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a, b = nd.split(ValueError)')
try: print('type(a).__name__ =>', type(a).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(a).__name__')
try: print('type(b).__name__ =>', type(b).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(b).__name__')
try: print('type(nd.subgroup(Exception)).__name__ =>', type(nd.subgroup(Exception)).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(nd.subgroup(Exception)).__name__')
try:
    class BadDerive(ExceptionGroup):
        def derive(self, excs): return 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadDerive(ExceptionGroup):')
try: print('BadDerive("b", [ValueError(1), TypeError(2)]).split(ValueError) =>', end=" "); t(lambda: BadDerive("b", [ValueError(1), TypeError(2)]).split(ValueError))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: BadDerive("b", [ValueError(1), TypeError(2)]).split(ValueEr...')
try:
    class BaseOnly(BaseExceptionGroup): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BaseOnly(BaseExceptionGroup): pass')
try:
    class ExcAndBase(BaseExceptionGroup, ValueError): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ExcAndBase(BaseExceptionGroup, ValueError): pass')
try: print('type(BaseOnly("b", [ValueError()])).__name__ =>', type(BaseOnly("b", [ValueError()])).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(BaseOnly("b", [ValueError()])).__name__')
try: print('type(BaseOnly("b", [KeyboardInterrupt()])).__name__ =>', type(BaseOnly("b", [KeyboardInterrupt()])).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(BaseOnly("b", [KeyboardInterrupt()])).__name__')
try: print('type(ExcAndBase("b", [ValueError()])).__name__ =>', type(ExcAndBase("b", [ValueError()])).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(ExcAndBase("b", [ValueError()])).__name__')
try: print('ExcAndBase("b", [KeyboardInterrupt()]) =>', end=" "); t(lambda: ExcAndBase("b", [KeyboardInterrupt()]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ExcAndBase("b", [KeyboardInterrupt()]))')
try: print('ExceptionGroup[int] =>', ExceptionGroup[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ExceptionGroup[int]')
try: print('BaseExceptionGroup[int] =>', BaseExceptionGroup[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: BaseExceptionGroup[int]')
try: print('g.__reduce__()[0].__name__ if hasattr(g, "__reduce__") else "" =>', g.__reduce__()[0].__name__ if hasattr(g, "__reduce__") else "")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__reduce__()[0].__name__ if hasattr(g, "__reduce__") else ""')
try: print('g == g =>', g == g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g == g')
try: print('g != ExceptionGroup("msg", [ValueError(1), TypeError(2)]) =>', g != ExceptionGroup("msg", [ValueError(1), TypeError(2)]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g != ExceptionGroup("msg", [ValueError(1), TypeError(2)])')
try: print('bool(g) =>', bool(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(g)')
# except*
try:
    def run(exc, *handlers):
        log = []
        src = "try:\n    raise exc\n" + "".join("except* %s as e:\n    log.append((%r, show(e)))\n" % (h, h) for h in handlers)
        try: exec(src, {"exc": exc, "log": log, "show": show})
        except BaseException as e: log.append(("escaped", show(e)))
        print(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(exc, *handlers):')
try: run(ExceptionGroup("g", [ValueError(1), TypeError(2)]), "ValueError")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(ExceptionGroup("g", [ValueError(1), TypeError(2)]), "ValueError")')
try: run(ExceptionGroup("g", [ValueError(1), TypeError(2)]), "ValueError", "TypeError")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(ExceptionGroup("g", [ValueError(1), TypeError(2)]), "ValueError",...')
try: run(ExceptionGroup("g", [ValueError(1), TypeError(2)]), "KeyError")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(ExceptionGroup("g", [ValueError(1), TypeError(2)]), "KeyError")')
try: run(ExceptionGroup("g", [ValueError(1), TypeError(2)]), "Exception")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(ExceptionGroup("g", [ValueError(1), TypeError(2)]), "Exception")')
try: run(ExceptionGroup("g", [ValueError(1), TypeError(2)]), "(ValueError, TypeError)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(ExceptionGroup("g", [ValueError(1), TypeError(2)]), "(ValueError,...')
try: run(ExceptionGroup("g", [ValueError(1), ValueError(2), TypeError(3)]), "ValueError")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(ExceptionGroup("g", [ValueError(1), ValueError(2), TypeError(3)])...')
try: run(n, "ValueError", "KeyError")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(n, "ValueError", "KeyError")')
try: run(n, "OSError", "Exception")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(n, "OSError", "Exception")')
try: run(ValueError("naked"), "ValueError")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(ValueError("naked"), "ValueError")')
try: run(ValueError("naked"), "TypeError")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(ValueError("naked"), "TypeError")')
try: run(ValueError("naked"), "TypeError", "Exception")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(ValueError("naked"), "TypeError", "Exception")')
try: run(KeyError("naked"), "LookupError", "KeyError")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(KeyError("naked"), "LookupError", "KeyError")')
try: run(BaseExceptionGroup("b", [KeyboardInterrupt(), ValueError(1)]), "ValueError")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(BaseExceptionGroup("b", [KeyboardInterrupt(), ValueError(1)]), "V...')
try: run(BaseExceptionGroup("b", [KeyboardInterrupt(), ValueError(1)]), "BaseException")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(BaseExceptionGroup("b", [KeyboardInterrupt(), ValueError(1)]), "B...')
try: run(KeyboardInterrupt(), "KeyboardInterrupt")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(KeyboardInterrupt(), "KeyboardInterrupt")')
try: run(mg, "ValueError")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(mg, "ValueError")')
try: run(ExceptionGroup("o", [ExceptionGroup("i", [ValueError(1)])]), "ValueError")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: run(ExceptionGroup("o", [ExceptionGroup("i", [ValueError(1)])]), "Val...')
try:
    def flow():
        out = []
        try: out.append("body")
        except* ValueError: out.append("no")
        else: out.append("else")
        finally: out.append("finally")
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def flow():')
try: print(flow())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: flow()')
try:
    def raise_in_handler():
        try: raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
        except* ValueError: raise KeyError("new")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raise_in_handler():')
try:
    def raise_in_two():
        try: raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
        except* ValueError: raise KeyError("k")
        except* TypeError: raise OSError("o")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raise_in_two():')
try:
    def reraise_bare():
        try: raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
        except* ValueError: raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def reraise_bare():')
try:
    def reraise_e():
        try: raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
        except* ValueError as e: raise e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def reraise_e():')
try:
    def reraise_all():
        try: raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
        except* ValueError: raise
        except* TypeError: raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def reraise_all():')
try:
    def raise_and_unhandled():
        try: raise ExceptionGroup("g", [ValueError(1), TypeError(2), OSError(3)])
        except* ValueError: raise KeyError("k")
        except* TypeError: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raise_and_unhandled():')
try:
    def raise_group_in_handler():
        try: raise ExceptionGroup("g", [ValueError(1)])
        except* ValueError: raise ExceptionGroup("new", [KeyError("k")])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raise_group_in_handler():')
try:
    def naked_reraise():
        try: raise ValueError("naked")
        except* ValueError: raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def naked_reraise():')
try:
    def nested_reraise():
        try: raise n
        except* ValueError: raise
        except* KeyError: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nested_reraise():')
try:
    for f in (raise_in_handler, raise_in_two, reraise_bare, reraise_e, reraise_all, raise_and_unhandled, raise_group_in_handler, naked_reraise, nested_reraise):
        try: f()
        except BaseException as e: print(f.__name__, show(e), "| ctx:", show(e.__context__) if e.__context__ else None, "| inner ctx:", [show(x.__context__) if x.__context__ else None for x in getattr(e, "exceptions", [])])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (raise_in_handler, raise_in_two, reraise_bare, reraise_e, re...')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try:
    def exc_in_handler():
        try: raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
        except* ValueError as e: print(show(sys.exception()), show(e), sys.exception() is e)
        except* TypeError as e: print(show(sys.exception()))
        print(sys.exception())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def exc_in_handler():')
try: exc_in_handler()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exc_in_handler()')
try:
    def name_deleted():
        try: raise ExceptionGroup("g", [ValueError(1)])
        except* ValueError as e: pass
        return e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def name_deleted():')
try: print('name_deleted() =>', end=" "); t(name_deleted)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(name_deleted)')
try: print('exec("try: raise ValueError\\nexcept* ExceptionGroup: pass") =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept* ExceptionGroup: pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept* ExceptionGroup: pass"))')
try: print('exec("try: raise ValueError\\nexcept* BaseExceptionGroup: pass") =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept* BaseExceptionGroup: pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept* BaseExceptionGroup: pa...')
try: print('exec("try: raise ValueError\\nexcept* (ValueError, ExceptionGroup): pa... =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept* (ValueError, ExceptionGroup): pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept* (ValueError, Exception...')
try: print('exec("try: raise ValueError\\nexcept* 1: pass") =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept* 1: pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept* 1: pass"))')
try: print('exec("try: raise ValueError\\nexcept* (ValueError, 1): pass") =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept* (ValueError, 1): pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept* (ValueError, 1): pass"))')
try: print('exec("try: raise ValueError\\nexcept* int: pass") =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept* int: pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept* int: pass"))')
try: print('exec("try: raise ValueError\\nexcept* (): pass") =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept* (): pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept* (): pass"))')
try: print('exec("try: pass\\nexcept* ExceptionGroup: pass\\nprint(\'checked only wh... =>', end=" "); t(lambda: exec("try: pass\nexcept* ExceptionGroup: pass\nprint('checked only when raised')"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: pass\\nexcept* ExceptionGroup: pass\\nprint(\'check...')
try: print('exec("try: raise ValueError\\nexcept* MyG: pass", {"MyG": MyGroup}) =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept* MyG: pass", {"MyG": MyGroup}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept* MyG: pass", {"MyG": My...')
try:
    for src in ("try: pass\nexcept*: pass", "try: pass\nexcept* ValueError: pass\nexcept TypeError: pass", "try: pass\nexcept ValueError: pass\nexcept* TypeError: pass", "try: pass\nexcept* ValueError: pass\nexcept: pass", "def f():\n try: pass\n except* ValueError: return", "for i in x:\n try: pass\n except* ValueError: break", "for i in x:\n try: pass\n except* ValueError: continue", "for i in x:\n try: pass\n except* ValueError:\n  for j in y: break", "def f():\n try: pass\n except* ValueError:\n  def g(): return", "try: pass\nexcept * ValueError: pass", "try: pass\nexcept *ValueError as e: pass", "try: pass\nexcept* ValueError, TypeError: pass", "try: pass\nexcept* ValueError, TypeError as e: pass", "try: pass\nexcept* (ValueError, TypeError) as e: pass", "try: pass\nexcept* ValueError as e.x: pass", "def f():\n try: return\n except* ValueError: pass", "def f():\n try: pass\n except* ValueError: pass\n else: return\n finally: return", "def g():\n try: yield\n except* ValueError: yield", "async def f():\n try: await x\n except* ValueError: await y"):
        try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
        except SyntaxError as e: print("SyntaxError:", e.msg)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("try: pass\\nexcept*: pass", "try: pass\\nexcept* ValueErro...')
try:
    def gen_star():
        try: yield 1; raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
        except* ValueError as e: yield show(e)
        except* TypeError as e: yield show(e)
        yield "end"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen_star():')
try: print(list(gen_star()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(gen_star())')
try:
    def loop_star():
        out = []
        for i in range(3):
            try:
                if i == 1: raise ExceptionGroup("g", [ValueError(i)])
                out.append(i)
            except* ValueError as e: out.append(show(e))
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop_star():')
try: print(loop_star())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: loop_star()')
try:
    def nested_star():
        try:
            try: raise ExceptionGroup("g", [ValueError(1), TypeError(2), KeyError(3)])
            except* ValueError as e: print("inner", show(e))
        except* TypeError as e: print("outer", show(e))
        except* KeyError as e: print("outer", show(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nested_star():')
try: nested_star()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nested_star()')

# The part that a clause caught stays the exception that is being handled until the next clause catches something: where that says what it catches.
try:
    def shown(e):
        return None if e is None else '%s(%s)' % (type(e).__name__, ', '.join(map(repr, e.args[:1])) + (': ' + ', '.join(shown(x) for x in e.exceptions) if isinstance(e, BaseExceptionGroup) else ''))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def shown(e):')
try:
    def between1():
        try:
            try:
                raise ExceptionGroup('g', [ValueError(1), TypeError(2)])
            except* ValueError:
                pass
            except* 1 / 0:
                pass
        except BaseException as e:
            print('between 1', shown(e), '| context', shown(e.__context__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def between1():')
try:
    def between2():
        try:
            try:
                raise ExceptionGroup('g', [ValueError(1), TypeError(2)])
            except* KeyError:
                pass
            except* 1 / 0:
                pass
        except BaseException as e:
            print('between 2', shown(e), '| context', shown(e.__context__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def between2():')
try:
    def between3():
        import sys
        def f():
            print('between 3 handled while the type is evaluated', shown(sys.exception()))
            return TypeError
        try:
            raise ExceptionGroup('g', [ValueError(1), TypeError(2)])
        except* ValueError:
            print('between 3 in clause', shown(sys.exception()))
        except* f():
            print('between 3 in clause', shown(sys.exception()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def between3():')
try:
    def between4():
        try:
            try:
                raise ExceptionGroup('g', [ValueError(1), TypeError(2), KeyError(3)])
            except* ValueError:
                pass
            except* TypeError:
                pass
            except* 1 / 0:
                pass
        except BaseException as e:
            print('between 4', shown(e), '| context', shown(e.__context__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def between4():')
try:
    def between5():
        try:
            try:
                raise ExceptionGroup('g', [ValueError(1), TypeError(2)])
            except* ValueError:
                raise OSError(5)
            except* 1 / 0:
                pass
        except BaseException as e:
            print('between 5', shown(e), '| context', shown(e.__context__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def between5():')
try:
    for between in (between1, between2, between3, between4, between5): between()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for between in (between1, between2, between3, between4, between5): be...')
