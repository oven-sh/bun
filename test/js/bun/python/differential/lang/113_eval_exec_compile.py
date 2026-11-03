import sys
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

x = 10
print(eval("1 + 2"), eval("x * 2"), eval("x", {"x": 5}), eval("x + y", {"x": 1}, {"y": 2}), eval("x", {"x": 1}, {"x": 2}), eval("[i * 2 for i in range(3)]"), eval("(lambda a: a + 1)(1)"), eval(" 1 + 1"), eval("\t1"), eval("1 + 1\n"), eval("1 + 1  \n\n"), eval("(1,\n2)"), eval("'é😀'"), eval(b"1 + 1"), eval(bytearray(b"2 * 3")), eval("None"), eval("len('abc')"), eval("x if x else 0"), eval("(y := 5) + y", {}), eval("__name__"), eval("__name__", {}), eval("__name__", {"__name__": "custom"}), eval("1,2"), eval("()"), eval("# comment\n1") if False else "", eval("1 # comment"), eval(memoryview(b"7")))
for src in ("", " ", "\n", "x = 1", "pass", "import sys", "1;2", "1\n2", "def f(): pass", "if 1: 2", "return 1", "yield 1", "1 +", "(", ")", "print 1", "x := 1", "del x", "for i in x: pass", "  1\n 2", "*x", "**x", "x y", "lambda", "#", "\\", "1 if", "a.", ".a", "a..b", "1..real", "1.real", "1 .real", "1.0.real", "@", "$", "?", "`x`", "x!", "!x", "x <> y", "x === y", "x => y", "x -> y", "x++", "not", "x not y", "x is not", "x not in", "await x", "async", "\x00", "1\x002", "a\x0cb", "\x0c1"):
    try: print("ok:", repr(src), repr(eval(src, {"x": [1], "y": 2, "a": 1})))
    except SyntaxError as e: print("SyntaxError:", e.msg, "<-", repr(src))
    except Exception as e: print(type(e).__name__ + ":", e, "<-", repr(src))
t(lambda: eval()); t(lambda: eval(1)); t(lambda: eval(None)); t(lambda: eval([])); t(lambda: eval("1", 1)); t(lambda: eval("1", [])); t(lambda: eval("1", {}, 1)); t(lambda: eval("1", None, None)); t(lambda: eval("1", {}, {}, {})); t(lambda: eval("undefined_name")); t(lambda: eval("undefined_name", {})); t(lambda: eval("x", {})); t(lambda: eval("1/0")); t(lambda: eval("len", {"__builtins__": {}})); t(lambda: eval("len", {"__builtins__": {"len": "fake"}})); t(lambda: eval("x", globals={"x": "kw globals"})); t(lambda: eval("x", locals={"x": "kw locals"})); t(lambda: eval(source="1")); t(lambda: eval("1", {1: 2})); t(lambda: eval("\ud800")); t(lambda: eval("'\ud800'"))
g = {}; eval("1", g); print(sorted(g), type(g["__builtins__"]).__name__)
g = {"__builtins__": None}; t(lambda: eval("len", g)); t(lambda: eval("1 + 1", g))
class M:
    def __getitem__(s, k):
        if k == "magic": return 42
        raise KeyError(k)
print(eval("magic", {}, M()), eval("magic + len('ab')", {}, M())); t(lambda: eval("other", {}, M())); t(lambda: eval("magic", M()))
class DS(dict):
    def __getitem__(s, k): return "from subclass getitem"
    def __missing__(s, k): return "missing " + k
print(eval("zz", {}, DS())); t(lambda: eval("zz", DS()))
def in_func():
    loc = "local"
    return eval("loc"), eval("loc + x", {"x": "!"}, locals()), eval("[loc for _ in range(1)]"), eval("(lambda: x)()")
print(in_func())
def closure_eval():
    free = "free"
    def inner(): return eval("free")
    def inner2(): free; return eval("free")
    return inner, inner2
i1, i2 = closure_eval(); t(i1); t(i2)
# exec
ns = {}; print(exec("a = 1\nb = a + 1", ns), ns["a"], ns["b"], sorted(k for k in ns if k != "__builtins__"))
exec("made_by_exec = 5"); print(made_by_exec)
exec("x = 11"); print(x); x = 10
ns = {}; exec("def f(n): return n * 2\nclass K:\n    v = f(2)\nr = [f(i) for i in range(3)]", ns); print(ns["f"](4), ns["K"].v, ns["r"], ns["f"].__globals__ is ns, ns["f"].__module__, ns["K"].__module__, ns["f"].__code__.co_filename)
g, l = {}, {}; exec("a = 1\ndef f(): return a", g, l); print(sorted(l), "a" in g); t(l["f"])
g, l = {"a": "global a"}, {}; exec("a = 'local a'\ndef f(): return a\nr = [a for _ in range(1)]\nclass C: b = a", g, l); print(l["f"](), l["r"], l["C"].b)
g, l = {}, {}; exec("global z; z = 1; w = 2", g, l); print("z" in g, "z" in l, "w" in g, "w" in l)
print(exec(""), exec("\n"), exec("# only a comment"), exec("pass"), exec("1 + 1"), exec(b"pass"), exec("x"), exec("  \n\t\n"), exec("if 1:\n  pass"), exec("if 1:\n  pass\n"), exec("a = 1;"), exec("a = 1\\\n+ 2"), exec("\x0c"), exec("pass\x0c"), exec(b"\xef\xbb\xbfpass"))
def exec_locals():
    v = 1
    exec("v = 2; new = 3")
    return v, "new" in locals()
print(exec_locals())
def exec_own_ns():
    v = 1; d = {"v": v}
    exec("v += 1; w = v * 2", d)
    return v, d["v"], d["w"]
print(exec_own_ns())
def exec_read():
    v = "visible"; out = []
    exec("out.append(v)")
    return out
print(exec_read())
t(lambda: exec("\\\n")); t(lambda: exec(chr(0xfeff) + "pass")); t(lambda: exec()); t(lambda: exec(1)); t(lambda: exec("x = ")); t(lambda: exec("return")); t(lambda: exec("yield")); t(lambda: exec("await x")); t(lambda: exec("break")); t(lambda: exec("continue")); t(lambda: exec("nonlocal x")); t(lambda: exec("raise ValueError('from exec')")); t(lambda: exec("1", 1)); t(lambda: exec("1", {}, 1)); t(lambda: exec("  x = 1")); t(lambda: exec("if 1:\npass")); t(lambda: exec("x = 1\n  y = 2")); t(lambda: exec("def f():\n\tpass\n        pass")); t(lambda: exec("sys.exit(3)", {"sys": sys})); t(lambda: exec("import sys; sys.exit('msg')")); t(lambda: exec("a\x00b")); t(lambda: exec("pass", closure=())); t(lambda: exec("pass", nope=1)); t(lambda: exec(b"\xff")); t(lambda: exec(b"x = '\xff'")); t(lambda: exec(b"# coding: latin-1\nprint('\xe9')")); t(lambda: exec(b"# -*- coding: nope -*-\npass")); t(lambda: exec("# coding: latin-1\nprint('é: the cookie is ignored for str')"))
def mk():
    v = "cell value"
    def f(): return v
    return f
f = mk(); print(eval(f.__code__, {}, closure=f.__closure__) if False else "", exec(f.__code__, {}, closure=f.__closure__)); t(lambda: exec(f.__code__, {})); t(lambda: eval(f.__code__, {})); t(lambda: exec(f.__code__, {}, closure=(1,))); t(lambda: exec(f.__code__, {}, closure=()))
# compile
c = compile("1 + 2", "<test>", "eval"); print(type(c).__name__, eval(c), c.co_filename, c.co_name, c.co_firstlineno, c.co_argcount, c.co_names, c.co_consts, c.co_varnames, c.co_flags & 0xFF, exec(c))
c = compile("a = 1\nb = a + 1", "file.py", "exec"); ns = {}; print(exec(c, ns), eval(c, ns), ns["b"], c.co_names, c.co_name, c.co_filename)
c = compile("1 + 2", "<s>", "single"); print(exec(c), "<- single prints the value through sys.displayhook")
for src in ("5", "'str'", "None", "x = 1", "1; 2", "[1, 2]", "print('p')", "a = 1; a", "if 1: 3\n", "for i in range(2): i\n", "1, 2", "...", "def f(): 1\n"):
    print(repr(src), end=": "); exec(compile(src, "<s>", "single"), {}); print("|")
for src in ("if 1: 3", "def f(): 1", "1\n2", "x = 1\ny = 2", "if 1:\n  1\n2", "", "\n", "def f(): pass\nf()", "1\n", "1\n\n", "if 1:\n  1\n", "# c", "1 # c\n"):
    try: compile(src, "<s>", "single"); print("ok:", repr(src))
    except SyntaxError as e: print("SyntaxError:", e.msg, "<-", repr(src))

hook_log = []; old_hook = sys.displayhook; sys.displayhook = hook_log.append; exec(compile("1 + 1", "<s>", "single")); exec(compile("None", "<s>", "single")); exec(compile("'a'; 2", "<s>", "single")); sys.displayhook = old_hook; print(hook_log, sys.__displayhook__ is old_hook)
g = {}; exec(compile("42", "<s>", "single"), g); print(eval("_", {}) if False else "", sys.modules["builtins"]._); del sys.modules["builtins"]._
t(lambda: compile()); t(lambda: compile("1")); t(lambda: compile("1", "f")); t(lambda: compile("1", "f", "nope")); t(lambda: compile("1", "f", 1)); t(lambda: compile(1, "f", "eval")); t(lambda: compile("1", 1, "eval")); t(lambda: compile("x = 1", "f", "eval")); t(lambda: compile("1", "f", "eval", 0x7FFFFFFF)); t(lambda: compile("1", "f", "eval", optimize=5)); t(lambda: compile("1", "f", "eval", optimize=-2)); t(lambda: compile("1", "f", "eval", nope=1)); t(lambda: compile("a\0b", "f", "exec")); t(lambda: compile(None, "f", "exec")); t(lambda: compile("1", "f", "eval", dont_inherit="x") and "ok"); t(lambda: compile("1", "f\0", "eval")); t(lambda: compile(c, "f", "exec") is c or "code objects pass through") if False else None
print(compile("1", "f", "eval", 0, True, -1).co_filename, compile(source="1", filename="f", mode="eval", flags=0, dont_inherit=False, optimize=-1).co_name, compile("x", "é.py", "eval").co_filename, compile("1", "", "eval").co_filename == "", compile(b"1", "f", "eval").co_consts, compile("pass", "f", "exec", _feature_version=-1).co_name)
# Code object details.
def sample(a, b=1, /, c=2, *d, e, f=3, **g):
    "doc"
    h = a + b
    def inner(): return h
    return [i for i in d], len(g), inner
co = sample.__code__
print(co.co_name, co.co_qualname, co.co_argcount, co.co_posonlyargcount, co.co_kwonlyargcount, co.co_nlocals, co.co_varnames, co.co_cellvars, co.co_freevars, co.co_names, co.co_flags & 0x0F, co.co_consts[0], co.co_filename.rsplit("/", 1)[-1], type(co.co_code).__name__, type(co.co_stacksize).__name__, co.co_firstlineno > 0, [type(k).__name__ for k in co.co_consts], sample(1, e=2)[2].__code__.co_freevars)
print(co == co, co == sample.__code__, co != (lambda: 0).__code__, hash(co) == hash(co), compile("1+1", "f", "eval") == compile("1+1", "f", "eval"), compile("1+1", "f", "eval") == compile("1+2", "f", "eval"), compile("a", "f", "eval") == compile("a", "g", "eval"))
r = co.replace(co_name="renamed"); print(r.co_name, co.co_name, r.co_argcount, type(r).__name__, co.replace() == co); t(lambda: co.replace(nope=1)); t(lambda: co.replace(co_name=1)); t(lambda: co.replace(co_argcount="a")); t(lambda: co.replace(1))
def s1(): co.co_name = "x"
def s2(): del co.co_name
def s3(): co.new = 1
t(s1); t(s2); t(s3); t(lambda: type(co)()); t(lambda: type("X", (type(co),), {}))
lines = compile("a = 1\n\nb = 2\nc = (3 +\n  4)\n", "f", "exec"); print(sorted({l for _, _, l in lines.co_lines() if l}), type(lines.co_lines()).__name__, type(lines.co_positions()).__name__)
# Nested code, constants folding must not change behaviour.
print(eval("2 ** 10"), eval("'a' * 3"), eval("(1, 2) + (3,)"), eval("1 + 2 * 3 - 4 / 2"), eval("-(-1)"), eval("not not 1"), eval("1 < 2 < 3"), eval("'a' 'b'"), eval("b'a' b'b'"), eval("1 if True else 2"), eval("[1, 2][0]"), eval("'abc'[1]"), eval("(1, 2, 3)[-1]"), eval("~5"), eval("5 // 2, 5 % 2, -5 // 2"), eval("2 ** -1"), eval("10 ** 20"), eval("1e308 * 10"), eval("0.1 + 0.2"), eval("True + True"), eval("None is None"), eval("1 in (1, 2)"), eval("'a' in 'abc'"), eval("3 in {1, 2, 3}"), eval("1 << 100"), eval("'%d' % 5"), eval("'%s-%s' % (1, 2)"), eval("f'{1 + 1}'"))
t(lambda: eval("1 / 0")); t(lambda: eval("1 % 0")); t(lambda: eval("1 // 0")); t(lambda: eval("'a' + 1")); t(lambda: eval("(1, 2)[5]")); t(lambda: eval("'abc'[10]")); t(lambda: eval("1 << -1")); t(lambda: eval("2 ** 'a'")); t(lambda: eval("-'a'")); t(lambda: eval("'a' * 'b'")); t(lambda: eval("0 ** -1")); t(lambda: eval("'%d' % 'a'")); t(lambda: eval("[] < 1")); t(lambda: eval("1 in 1")); t(lambda: eval("None + None")); t(lambda: eval("len('a' * 1000)"))
