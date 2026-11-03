# What the parser makes of the rest of a line once it cannot go on: type, message, position, text and _metadata of the SyntaxError.
try:
    def show(source, mode="exec"):
        try:
            compile(source, "<s>", mode)
            print(repr(source), "compiles")
        except SyntaxError as e:
            print(repr(source), mode, type(e).__name__, repr(e.msg), e.lineno, e.offset, e.end_lineno, e.end_offset, repr(e.text), e._metadata[:2] if e._metadata else None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(source, mode="exec"):')

# Two expressions side by side
for source in """
f(u 0 *, "")
eq(a['b'], c.d[])
f(a b.)
f(a, b c.)
f(a +, b c)
[a b +]
{a b: c}
(a b[)
f(a b(1 = 2))
f(b c(d e))
b c(d e)
a, b c(d e)
print c(d e)
exec c(d e)
print "hello"
print"reply:"(, repr(line))
b c[d e]
b [d e]
b (d e)
b.x [d e]
b [**c]
b {**c, d e}
b c + (d e)
b c, (d e)
b c, d(e f)
b -c(d e)
b not c(d e)
b lambda: (d e)
b c if (d e) else f
b c if d else (e f)
b *c(d e)
b c d(e f)
x = b c(d e)
b 1 + (d e)
b c = (d e)
b await (d e)
b c(1 = 2)
b c(d for d in e, f)
b [c for c in d e]
b c.d(e f)
b "s" (d e)
b c; (d e)
A[**b]
A[**b] = 1
del A[**b]
del A[*(1:2)]
x = "a" b "c"
x = "a" b c "d"
x = "a" b. "c"
x = b'I' + str(m).encode"ascii"() + b'n'
x = b"a" + _ b'a' * 1023
""".strip().split("\n"):
    try: show(source + "\n")
    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(source + "\\n")')

# Conditional expressions
for source in """
x = 'n' if support. else ''
x = a if b
x = a if b c
x = (a if b)
x = a if b else
x = a if b else +
x = a if b else pass
x = a if b else (c +)
x = a if b else (c d)
x = a if b else lambda v= f(v)
x = a if b else *c
x = a if b else **c
x = pass if a else b
x = a if b: c
f(a if b. else c)
[a if b +]
""".strip().split("\n"):
    try: show(source + "\n")
    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(source + "\\n")')

# A statement that starts like a tuple is tried as `a, b: annotation`, element by element
for source in """
a, b c: int
a, b c = 1
a b = 1
a, b = 1 2
a, type b = c
a, b c d = 1
a, (b c) = 1
a, b c := 1
a, b.c d.e = 1
a, b 1 = 1
a, b f() = 1
a b, c = 1
x = a, b c = 1
a, b c == 1
a, *b c = 1
a, b *c = 1
a, b, c d: int = 3
a, b: int
(a, b): int
[a, b]: int
a.b, c: int
f(): int
a, b += 1
a, b := 1
a.b := 1
a, b.c := 1
r, g, type b = args
""".strip().split("\n"):
    try: show(source + "\n")
    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(source + "\\n")')

# := where it cannot be
for source in """
f(a.b := 1)
f(x, a.b := 1)
f(a[0] := 1)
(a.b := 1)
[a.b := 1]
{a.b := 1}
f(int(x) := 1)
self.f(int(x):= 1)
f(a.b := 1 for x in y)
f(1 := 1)
f(a := 1, b := 2)
f(a=b := 1)
f(g(), t.A:=
x[a.b := 1]
x[a := 1]
x[a := 1, b := 2]
x[a:=1:2]
""".strip().split("\n"):
    try: show(source + "\n")
    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(source + "\\n")')

# Arguments
for source in """
h.set(A, 'a'for )
h.set('a'for )
h.set('a' for x in y, 1)
h.set(1, 'a' for x in y)
h.set(1, 'a' for x in)
h.set(a=1, 'a' for x in y)
f(a=1, b)
f(**a, b)
f(a=1, b, c d)
f(**a, *b)
f(a=)
f(a=, b)
f(a, b=)
f(True=1)
f(a.b=1)
f(a=1 for x in y)
f(*a=1)
f(**a=1)
f(*)
f(* *a)
f(a, *)
f(a, *(<= b))
f(1, x=2, *[,3 4], y=5)
f(**)
f(a for a in b for)
""".strip().split("\n"):
    try: show(source + "\n")
    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(source + "\\n")')

# del, def, class, import, raise
for source in """
del +.f
del x +
del x y
del f()
del (a, f())
del a, b +
del (a b)
del f(x y)
del a.b.
del *a
del 1
del
def bar(a, b:int) -> 1.5 float: pass
def bar(a) -> : pass
def bar(a) -> x. : pass
def bar(a) -> x y z: pass
def bar(a) x: pass
def bar[T(a): pass
def bar[T] x(a): pass
def foo( (self): pass
def f(*args: *b = (1,)): pass
def f(*args: b = (1,)): pass
def f(*args = 1): pass
def f(**kw = 1): pass
class A[]T: pass
class A[]: pass
class A(b c): pass
class A x: pass
from decimal import Decimal as D D
from a import b as c.d
import a as b.c
import a as b c
from a import (b c)
raise ValueError(msg) from from ex
raise from x
raise x from
for 1.5 _ in range(3): pass
for x y in z: pass
for x in y z: pass
for f() in x: pass
with a as b c: pass
with a b: pass
type X[[str, Y[X]]
type X[T] Y = int
""".strip().split("\n"):
    try: show(source + "\n")
    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(source + "\\n")')

# Displays
for source in """
e = {**e, 'n': 'a', , 'r': 'b'}
n = {**s.m, **m. .d}
{**a for a in {1: 2}.items(): b}
{**a, b}
{a, **b}
{a: b, **c d}
{a: b, c}
{a: b, c:}
{a: *b}
{*a: b}
{**a: b}
{a: **b}
[**a]
(**a)
(**a, b)
(a, **b)
[a, **b]
[*a if b else c]
{**a if b else c}
(*a)
[*a for a in b for]
""".strip().split("\n"):
    try: show(source + "\n")
    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(source + "\\n")')

# Which compound statement the error comes after (_metadata: traceback.py looks for misspelt keywords from there on)
try:
    for source in [
        "def f():\n  pass\nx y\n",
        "async def f():\n  pass\nx y\n",
        "class C:\n  pass\nx y\n",
        "class C:\n  def m(self): pass\n  x y\n",
        "class C:\n  class D:\n    pass\n  def m(self): pass\n  x y\n",
        "if a:\n  x\nx y\n",
        "if a:\n  x\nelif \n",
        "if a:\n  x\nelif b:\n  y\nelif c d:\n  z\n",
        "if a:\n  x\nelse:\n  x y\n",
        "if a:\n  x\nelse:\n  f(x y)\n",
        "if a:\n  x\nelse\n  y\n",
        "if a:\n  x y\n",
        "while a:\n  x\nelse:\n  x y\n",
        "for a in b:\n  x\nelse:\n  x y\n",
        "for a in b:\n  x\nelsee:\n  y\n",
        "try:\n  x\nexcept A:\n  y\nexcept B C:\n  z\n",
        "try:\n  x\nexcept A:\n  y\nelse:\n  x y\n",
        "try:\n  x\nexcept A:\n  y\nfinally:\n  x y\n",
        "try:\n  x\nfinally:\n  x y\n",
        "try:\n  x y\nfinally:\n  z\n",
        "with a:\n  x\nx y\n",
        "match a:\n  case 1:\n    x\nx y\n",
        "match a:\n  case 1:\n    x\n  case 2:\n    x y\n",
        "def f():\n  if a:\n    x\n  x y\n",
        "def f():\n  if a:\n    x\n  def g(): pass\n  x y\n",
        "@d\nclass C:\n  pass\nx y\n",
        "@d\ndef f():\n  pass\nx y\n",
        "if a:\n  x\nif b:\n  y\nx y\n",
        "if a:\n  if b:\n    y\nx y\n",
        "if a:\n  x\nf(x y)\n",
        "if a:\n  x\n'unterminated\n",
        "if a:\n  x\nf(\n",
        "if a:\n  x\ny = )\n",
        "if a:\n  x\n    y\n",
        "if a:\n  x\nwhile b\n  y\n",
        "if a:\n  x\ndef f(:\n  y\n",
        "x y\n",
    ]:
        try: show(source)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(source)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for source in [')

# One statement at a time
try:
    for source in [
        "match x:\n  case 1:\n    pass\n", "match x:\n  case 1:\n    pass\n\n", "match x:\n  case 1: pass\ny\n", "match = 1\n", "match(x)\n", "match x y\n", "case = 1\n",
        "type X = int\n", "lazy import a\n", "x = 1\ny = 2\n", "x = 1; y = 2\n", "x = 1 # comment\n# more\n", "if a:\n  x\ny\n", "if a:\n  x\n", "if a: x\n", "if a: x\ny\n",
        "ep ='ep',\n    value='x'\n)\n", "x = 1\n)\n", "x = 1\n'unterminated\n", "def f(): pass\n", "def f(): pass\nf()\n", "", "\n", "  \n", "# only a comment\n", "x y\n", "x = (\n",
        "@d\nclass C: pass\n", "for x in y: pass\nelse: pass\n", "try: pass\nfinally: pass\n", "with a: pass\n", "async def f(): pass\n", "while x: pass\n",
    ]:
        try: show(source, "single")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(source, "single")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for source in [')
try:
    for source in ["x y", "x = 1", "", "\n", "(", "x\ny", "x;", "pass", "*a", "a := 1", "(a := 1)", "yield", "lambda: (yield)", "a if b", " x", "x #c\n#d\n"]:
        try: show(source, "eval")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(source, "eval")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for source in ["x y", "x = 1", "", "\\n", "(", "x\\ny", "x;", "pass", "...')
