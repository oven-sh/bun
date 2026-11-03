try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try:
    def t(f):
        try:
            print(repr(f()))
        except BaseException as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
    def here(): return sys._getframe()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def here(): return sys._getframe()')
try: f = here()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f = here()')
try: print('type(f).__name__ =>', type(f).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(f).__name__')
try: print('f.f_code is here.__code__ =>', f.f_code is here.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.f_code is here.__code__')
try: print('f.f_code.co_name =>', f.f_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.f_code.co_name')
try: print('f.f_globals is globals() =>', f.f_globals is globals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.f_globals is globals()')
try: print('f.f_builtins is sys.modules["builtins"].__dict__ =>', f.f_builtins is sys.modules["builtins"].__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.f_builtins is sys.modules["builtins"].__dict__')
try: print('f.f_back.f_code.co_name =>', f.f_back.f_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.f_back.f_code.co_name')
try: print('f.f_lineno == here.__code__.co_firstlineno =>', f.f_lineno == here.__code__.co_firstlineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.f_lineno == here.__code__.co_firstlineno')
try: print('f.f_locals =>', f.f_locals)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.f_locals')
try: print('type(f.f_lasti).__name__ =>', type(f.f_lasti).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(f.f_lasti).__name__')
try: print('f.f_trace =>', f.f_trace)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.f_trace')
try: print('f.f_trace_lines =>', f.f_trace_lines)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.f_trace_lines')
try: print('f.f_trace_opcodes =>', f.f_trace_opcodes)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.f_trace_opcodes')
try: print('f.f_generator =>', f.f_generator)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.f_generator')
try: print('repr(f)[:12] =>', repr(f)[:12])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(f)[:12]')
try: print('"file" in repr(f) =>', "file" in repr(f))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "file" in repr(f)')
try: print('"line" in repr(f) =>', "line" in repr(f))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "line" in repr(f)')
try: print('"code here" in repr(f) =>', "code here" in repr(f))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "code here" in repr(f)')
try: m = sys._getframe()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m = sys._getframe()')
try: print('m.f_code.co_name =>', m.f_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.f_code.co_name')
try: print('m.f_back =>', m.f_back)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.f_back')
try: print('m.f_locals is globals() =>', m.f_locals is globals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.f_locals is globals()')
try: print('m.f_globals is globals() =>', m.f_globals is globals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.f_globals is globals()')
try: print('m.f_code.co_filename.rsplit("/", 1)[-1] =>', m.f_code.co_filename.rsplit("/", 1)[-1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.f_code.co_filename.rsplit("/", 1)[-1]')
try: print('m.f_code.co_firstlineno =>', m.f_code.co_firstlineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.f_code.co_firstlineno')
try:
    def names(depth=0):
        fr = sys._getframe(depth); out = []
        while fr: out.append(fr.f_code.co_name); fr = fr.f_back
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def names(depth=0):')
try:
    def a(): return b()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a(): return b()')
try:
    def b(): return c()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b(): return c()')
try:
    def c(): return names()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c(): return names()')
try: print('a() =>', a())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a()')
try: print('names() =>', names())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names()')
try: print('names(1) =>', names(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names(1)')
try:
    def caller(): return sys._getframe(1).f_code.co_name, sys._getframe(1).f_globals["__name__"], sys._getframe(2).f_code.co_name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def caller(): return sys._getframe(1).f_code.co_name, sys._getframe(1...')
try:
    def calls_caller(): return caller()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def calls_caller(): return caller()')
try: print(calls_caller())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls_caller()')
try: print('sys._getframe(100) =>', end=" "); t(lambda: sys._getframe(100))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sys._getframe(100))')
try: print('sys._getframe(-1).f_code.co_name =>', end=" "); t(lambda: sys._getframe(-1).f_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sys._getframe(-1).f_code.co_name)')
try: print('sys._getframe("a") =>', end=" "); t(lambda: sys._getframe("a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sys._getframe("a"))')
try: print('sys._getframe(1, 2) =>', end=" "); t(lambda: sys._getframe(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sys._getframe(1, 2))')
try: print('sys._getframe(2 ** 70) =>', end=" "); t(lambda: sys._getframe(2 ** 70))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sys._getframe(2 ** 70))')
try: print('(lambda: sys._getframe().f_code.co_name)() =>', (lambda: sys._getframe().f_code.co_name)())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (lambda: sys._getframe().f_code.co_name)()')
try: print('[sys._getframe().f_code.co_name for _ in range(1)] =>', [sys._getframe().f_code.co_name for _ in range(1)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [sys._getframe().f_code.co_name for _ in range(1)]')
try: print('list(sys._getframe().f_code.co_name for _ in range(1)) =>', list(sys._getframe().f_code.co_name for _ in range(1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(sys._getframe().f_code.co_name for _ in range(1))')
try: print('type("K", (), {"n": sys._getframe().f_code.co_name}).n =>', type("K", (), {"n": sys._getframe().f_code.co_name}).n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type("K", (), {"n": sys._getframe().f_code.co_name}).n')
try:
    class Body:
        fr = sys._getframe()
        name = fr.f_code.co_name; back = fr.f_back.f_code.co_name; loc = "name" in fr.f_locals or sorted(k for k in fr.f_locals if not k.startswith("__"))
        del fr
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Body:')
try: print('Body.name =>', Body.name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Body.name')
try: print('Body.back =>', Body.back)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Body.back')
try: print('Body.loc =>', Body.loc)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Body.loc')
try:
    def through_builtins(): return list(map(lambda _: names(), [0]))[0], sorted([0], key=lambda _: out.extend(names()) or 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def through_builtins(): return list(map(lambda _: names(), [0]))[0], ...')
try: out = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out = []')
try: print('through_builtins()[0] =>', through_builtins()[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: through_builtins()[0]')
try: print('out =>', out)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out')
try:
    class M:
        def meth(s): return names()
        def __len__(s): out.extend(names()); return 0
        @property
        def p(s): return names()
        def __call__(s): return names()
        def __getattr__(s, n): return names()
        def __enter__(s): return names()
        def __exit__(s, *a): pass
        def __iter__(s): out.extend(names()); return iter(())
        def __init__(s): s.made = names()
        def __eq__(s, o): out.extend(names()); return True
        __hash__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M:')
try: mm = M()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mm = M()')
try: out = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out = []')
try: len(mm)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(mm)')
try: print('mm.meth() =>', mm.meth())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mm.meth()')
try: print('out =>', out)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out')
try: print('mm.p =>', mm.p)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mm.p')
try: print('mm() =>', mm())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mm()')
try: print('mm.missing =>', mm.missing)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mm.missing')
try: print('mm.made =>', mm.made)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mm.made')
try:
    with mm as w: print(w)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with mm as w: print(w)')
try: out = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out = []')
try: list(mm)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(mm)')
try: print(out)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out')
try: out = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out = []')
try: mm == 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mm == 1')
try: print(out)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out')
try:
    def gen(): yield names()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen(): yield names()')
try:
    def drive(): return next(gen())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def drive(): return next(gen())')
try: print('drive() =>', drive())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: drive()')
try: print('list(gen()) =>', list(gen()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(gen())')
try:
    def gen_back():
        yield sys._getframe().f_back.f_code.co_name
        yield sys._getframe().f_back.f_code.co_name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gen_back():')
try: g = gen_back()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = gen_back()')
try:
    def first(): return next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def first(): return next(g)')
try:
    def second(): return next(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def second(): return next(g)')
try: print('first() =>', first())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first()')
try: print('second() =>', second())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: second()')
try: print('g.gi_frame.f_back =>', g.gi_frame.f_back)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.gi_frame.f_back')
try:
    async def co(): return names()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def co(): return names()')
try:
    def drive_co():
        try: co().send(None)
        except StopIteration as e: return e.value
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def drive_co():')
try: print(drive_co())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: drive_co()')
try: print('eval("names()") =>', eval("names()"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: eval("names()")')
try: print('eval("sys._getframe().f_code.co_name") =>', eval("sys._getframe().f_code.co_name"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: eval("sys._getframe().f_code.co_name")')
try: print('eval("sys._getframe().f_code.co_filename") =>', eval("sys._getframe().f_code.co_filename"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: eval("sys._getframe().f_code.co_filename")')
try: exec("print(names(), sys._getframe().f_code.co_name, sys._getframe().f_lineno)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exec("print(names(), sys._getframe().f_code.co_name, sys._getframe()....')
try: exec("\n\nprint(sys._getframe().f_lineno)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exec("\\n\\nprint(sys._getframe().f_lineno)")')
# f_lineno follows execution.
try:
    def lines():
        base = sys._getframe().f_lineno
        x = sys._getframe().f_lineno - base
        y = (sys._getframe().f_lineno
             - base)
        z = [
            sys._getframe().f_lineno - base,
            sys._getframe().f_lineno - base,
        ]
        return x, y, z
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lines():')
try: print(lines())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lines()')
try:
    def caller_line(): return sys._getframe(1).f_lineno
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def caller_line(): return sys._getframe(1).f_lineno')
try: base = sys._getframe().f_lineno
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: base = sys._getframe().f_lineno')
try: print('caller_line() - base =>', caller_line() - base)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: caller_line() - base')
try: print('caller_line() - base =>', (caller_line()
      - base
))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: caller_line() - base')
try: print('[caller_line() - base, caller_line() - base] =>', ([caller_line() - base,
 caller_line() - base]
))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [caller_line() - base, caller_line() - base]')
# f_locals
try:
    def loc(p, q=2):
        r = 3
        fr = sys._getframe()
        snap = dict(fr.f_locals); snap.pop("fr")
        return snap, type(fr.f_locals).__name__, "r" in fr.f_locals, fr.f_locals["p"], len(fr.f_locals), sorted(fr.f_locals), fr.f_locals.get("zz", "dflt")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loc(p, q=2):')
try: print(loc(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: loc(1)')
try:
    def write_through():
        x = 1
        fr = sys._getframe()
        fr.f_locals["x"] = 2
        fr.f_locals["extra"] = 3
        return x, fr.f_locals["extra"], "extra" in fr.f_locals, "extra" in locals(), sorted(fr.f_locals)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def write_through():')
try: print(write_through())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: write_through()')
try:
    def other_frame_write():
        v = "original"
        def change(): sys._getframe(1).f_locals["v"] = "changed by the callee"
        change()
        return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def other_frame_write():')
try: print(other_frame_write())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: other_frame_write()')
try:
    def cells():
        c = "cell"
        def inner(): return c, sorted(sys._getframe().f_locals), sys._getframe().f_locals["c"]
        return inner(), sys._getframe().f_locals["c"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cells():')
try: print(cells())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cells()')
try:
    def unbound_local():
        fr = sys._getframe()
        before = "later" in fr.f_locals
        later = 1
        after = "later" in fr.f_locals
        del later
        return before, after, "later" in fr.f_locals
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def unbound_local():')
try: print(unbound_local())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: unbound_local()')
try:
    def proxy_errors():
        fl = sys._getframe().f_locals
        r = []
        for op in (lambda: fl["nope"], lambda: fl.pop("fl"), lambda: fl.clear(), lambda: fl.__delitem__("fl"), lambda: fl.__setitem__(1, 2), lambda: hash(fl), lambda: fl.popitem()):
            try: op(); r.append("ok")
            except Exception as e: r.append(type(e).__name__ + ": " + str(e))
        return r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def proxy_errors():')
try: print(proxy_errors())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: proxy_errors()')
try:
    def kept():
        secret = 42
        return sys._getframe()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def kept():')
try: k = kept()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: k = kept()')
try: print('k.f_locals["secret"] =>', k.f_locals["secret"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: k.f_locals["secret"]')
try: print('k.f_back and k.f_back.f_code.co_name =>', k.f_back and k.f_back.f_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: k.f_back and k.f_back.f_code.co_name')
try: print('k.f_code.co_name =>', k.f_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: k.f_code.co_name')
try: print('dict(k.f_locals) =>', dict(k.f_locals))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dict(k.f_locals)')
try:
    def s1(): f.f_code = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s1(): f.f_code = None')
try:
    def s2(): f.f_back = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s2(): f.f_back = None')
try:
    def s3(): f.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s3(): f.x = 1')
try:
    def s4(): f.f_lineno = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s4(): f.f_lineno = 1')
try:
    def s5(): f.f_locals = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s5(): f.f_locals = {}')
try:
    def s6(): del f.f_trace
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s6(): del f.f_trace')
try:
    for s in (s1, s2, s3, s4, s5): t(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for s in (s1, s2, s3, s4, s5): t(s)')
try: print('type(f)() =>', end=" "); t(lambda: type(f)())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(f)())')
try: print('f.clear() =>', end=" "); t(lambda: f.clear())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: f.clear())')
try: print('sys._getframe().clear() =>', end=" "); t(lambda: sys._getframe().clear())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: sys._getframe().clear())')
try: print('f == f =>', end=" "); t(lambda: f == f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: f == f)')
try: print('hash(f) == hash(f) =>', end=" "); t(lambda: hash(f) == hash(f))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: hash(f) == hash(f))')
try: print('type("X", (type(f),), {}) =>', end=" "); t(lambda: type("X", (type(f),), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (type(f),), {}))')
# Tracebacks.
try:
    def boom(): raise ValueError("boom")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def boom(): raise ValueError("boom")')
try:
    def mid(): boom()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def mid(): boom()')
try:
    def top():
        try: mid()
        except ValueError as e: return e.__traceback__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def top():')
try: tb = top()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tb = top()')
try:
    def walk(tb):
        out = []
        while tb: out.append((tb.tb_frame.f_code.co_name, tb.tb_lineno - tb.tb_frame.f_code.co_firstlineno, type(tb.tb_lasti).__name__)); tb = tb.tb_next
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def walk(tb):')
try: print('type(tb).__name__ =>', type(tb).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(tb).__name__')
try: print('walk(tb) =>', walk(tb))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: walk(tb)')
try: print('tb.tb_frame.f_code.co_name =>', tb.tb_frame.f_code.co_name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tb.tb_frame.f_code.co_name')
try: print('tb.tb_next.tb_next.tb_next =>', tb.tb_next.tb_next.tb_next)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tb.tb_next.tb_next.tb_next')
try: print('repr(tb)[:17] =>', repr(tb)[:17])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(tb)[:17]')
try: TB = type(tb)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TB = type(tb)')
try: new = TB(None, tb.tb_frame, tb.tb_lasti, 99)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: new = TB(None, tb.tb_frame, tb.tb_lasti, 99)')
try: print('new.tb_lineno =>', new.tb_lineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: new.tb_lineno')
try: print('new.tb_next =>', new.tb_next)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: new.tb_next')
try: print('new.tb_frame is tb.tb_frame =>', new.tb_frame is tb.tb_frame)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: new.tb_frame is tb.tb_frame')
try: new2 = TB(new, tb.tb_frame, 0, 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: new2 = TB(new, tb.tb_frame, 0, 1)')
try: print(new2.tb_next is new)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: new2.tb_next is new')
try: print('TB() =>', end=" "); t(lambda: TB())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: TB())')
try: print('TB(1, tb.tb_frame, 0, 1) =>', end=" "); t(lambda: TB(1, tb.tb_frame, 0, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: TB(1, tb.tb_frame, 0, 1))')
try: print('TB(None, 1, 0, 1) =>', end=" "); t(lambda: TB(None, 1, 0, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: TB(None, 1, 0, 1))')
try: print('TB(None, tb.tb_frame, "a", 1) =>', end=" "); t(lambda: TB(None, tb.tb_frame, "a", 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: TB(None, tb.tb_frame, "a", 1))')
try: print('type("X", (TB,), {}) =>', end=" "); t(lambda: type("X", (TB,), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (TB,), {}))')
try: new.tb_next = tb
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: new.tb_next = tb')
try: print(new.tb_next is tb)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: new.tb_next is tb')
try: new.tb_next = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: new.tb_next = None')
try: print(new.tb_next)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: new.tb_next')
try:
    def n1(): new.tb_next = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n1(): new.tb_next = 1')
try:
    def n2(): new.tb_next = new
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n2(): new.tb_next = new')
try:
    def n3(): new.tb_frame = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n3(): new.tb_frame = None')
try:
    def n4(): new.tb_lineno = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n4(): new.tb_lineno = 1')
try:
    def n5(): del new.tb_next
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n5(): del new.tb_next')
try:
    def n6():
        x = TB(None, tb.tb_frame, 0, 1); y = TB(x, tb.tb_frame, 0, 1); x.tb_next = y
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def n6():')
try:
    for n in (n1, n2, n3, n4, n5, n6): t(n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for n in (n1, n2, n3, n4, n5, n6): t(n)')
def multi_line_raise():
    try:
        raise ValueError(
            "spread over"
            " lines")
    except ValueError as e: return e.__traceback__.tb_lineno - multi_line_raise.__code__.co_firstlineno
try:
    def multi_line_call():
        try:
            int(
                "x"
            )
        except ValueError as e: return e.__traceback__.tb_lineno - multi_line_call.__code__.co_firstlineno
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def multi_line_call():')
try:
    def multi_line_expr():
        try:
            x = (1 +
                 2 /
                 0 +
                 3)
        except ZeroDivisionError as e: return e.__traceback__.tb_lineno - multi_line_expr.__code__.co_firstlineno
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def multi_line_expr():')
try:
    def in_for_header():
        try:
            for x in (
                5
            ): pass
        except TypeError as e: return e.__traceback__.tb_lineno - in_for_header.__code__.co_firstlineno
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_for_header():')
try:
    def in_with_exit():
        class CM:
            def __enter__(s): pass
            def __exit__(s, *a): raise KeyError("exit")
        try:
            with CM():
                pass
                pass
        except KeyError as e: return e.__traceback__.tb_lineno - in_with_exit.__code__.co_firstlineno
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_with_exit():')
try:
    def reraised():
        try:
            try:
                1 / 0
            except ZeroDivisionError:
                raise
        except ZeroDivisionError as e: return walk(e.__traceback__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def reraised():')
try:
    def raised_again():
        try:
            try:
                1 / 0
            except ZeroDivisionError as z:
                raise z
        except ZeroDivisionError as e: return walk(e.__traceback__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raised_again():')
try:
    def from_finally():
        try:
            try:
                1 / 0
            finally:
                pass
        except ZeroDivisionError as e: return walk(e.__traceback__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def from_finally():')
try: print('multi_line_raise() =>', multi_line_raise())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: multi_line_raise()')
try: print('multi_line_call() =>', multi_line_call())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: multi_line_call()')
try: print('multi_line_expr() =>', multi_line_expr())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: multi_line_expr()')
try: print('in_for_header() =>', in_for_header())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: in_for_header()')
try: print('in_with_exit() =>', in_with_exit())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: in_with_exit()')
try: print('reraised() =>', reraised())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: reraised()')
try: print('raised_again() =>', raised_again())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: raised_again()')
try: print('from_finally() =>', from_finally())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: from_finally()')
try:
    def frames_alive():
        def inner(): local_value = "kept alive by the traceback"; raise ValueError
        try: inner()
        except ValueError as e: return e.__traceback__.tb_next.tb_frame.f_locals["local_value"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def frames_alive():')
try: print(frames_alive())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frames_alive()')
try: e1 = ValueError("no traceback until raised")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e1 = ValueError("no traceback until raised")')
try: print(e1.__traceback__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e1.__traceback__')
try:
    try: raise e1
    except ValueError: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: raise e1')
try: print(walk(e1.__traceback__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: walk(e1.__traceback__)')
try:
    try: raise e1
    except ValueError: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: raise e1')
try: print('walk(e1.__traceback__) =>', walk(e1.__traceback__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: walk(e1.__traceback__)')
try: print("raising again prepends nothing at the same level but appends an entry")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "raising again prepends nothing at the same level but appends an entry"')
