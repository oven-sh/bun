# The part of the source that a traceback underlines: co_positions() at tb_lasti, for errors in all kinds of expressions and statements.
try: import itertools, sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import itertools, sys')

try:
    class Bad:
        def __bool__(self): raise ValueError("bool")
        def __iter__(self): raise ValueError("iter")
        def __enter__(self): raise ValueError("enter")
        def __exit__(self, *a): pass
        def __hash__(self): raise ValueError("hash")
        def __format__(self, spec): raise ValueError("format")
        def __index__(self): raise ValueError("index")
        def __await__(self): raise ValueError("await")
        def __contains__(self, x): raise ValueError("contains")
        def __len__(self): raise ValueError("len")
        def __eq__(self, other): raise ValueError("eq")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Bad:')
try:
    class BadExit:
        def __enter__(self): return self
        def __exit__(self, *a): raise ValueError("exit")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadExit:')
try:
    class BadNext:
        def __iter__(self): return self
        def __next__(self): raise ValueError("next")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadNext:')

try:
    def where(source, **names):
        names.update(Bad=Bad, bad=Bad(), BadExit=BadExit, BadNext=BadNext, none=None, zero=0, d={}, l=[], o=object())
        try:
            exec(compile(source, "<snippet>", "exec"), names)
        except BaseException as e:
            spots = []
            tb = e.__traceback__.tb_next
            while tb:
                if tb.tb_frame.f_code.co_filename == "<snippet>":
                    spots.append((tb.tb_frame.f_code.co_name, tb.tb_lineno) + next(itertools.islice(tb.tb_frame.f_code.co_positions(), tb.tb_lasti // 2, None)))
                tb = tb.tb_next
            print(repr(source), type(e).__name__, spots)
        else:
            print(repr(source), "no error")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def where(source, **names):')

try: SNIPPETS = r'''
x = 1 + none
x = none + 1 + 2
x = 1 + 2 + none
x = (1 +
     none)
x = 1 * (2 + none) * 3
x = -none
x = ~none
x = not bad
x = 1 / zero
x = 1 // zero + 1
x = 2 ** none
x = none @ none
x = 1 < none
x = 1 < 2 < none
x = 1 < none < 3
x = 1 in none
x = 1 not in none
x = 1 in bad
x = bad == 1
x = bad and 1
x = 1 and bad and 2
x = 0 or bad or 2
x = 1 if bad else 2
x = none.attr
x = o.a.b
x = none.attr.other
x = (none
     .attr)
x = o.attr(1, 2)
x = none()
x = none(1,
         2)
x = len(1, 2, 3)
x = len(none)
x = len(len(none))
x = int("x", base=none)
x = d["k"]
x = d["a"]["b"]
x = l[0]
x = l[1:2:zero]
x = none[0]
x = none[1:2]
x = l[none]
x = d[bad]
x = {bad: 1}
x = {bad}
x = {1: 2, bad: 3}
x = {**none}
x = {"a": 1, **none}
x = [*none]
x = [1, *none, 2]
x = (*none,)
x = {*none}
x = f"{bad}"
x = f"a{1}b{bad:>3}c"
x = f"{none.attr}"
x = f"{1:{bad}}"
x = "%d" % "s"
x = "a" "b" + 1
x = [y for y in none]
x = [y.a for y in [1]]
x = [y for y in [1] if y.a]
x = [z for y in [1] for z in y]
x = {y: y.a for y in [1]}
x = {y.a for y in [1]}
x = list(y.a for y in [1])
x = sum(y for y in none)
x = (lambda: none.a)()
x = (lambda a: a + 1)(none)
x = lambda: 0; x(1)
none.attr = 1
o.attr = 1
none.a.b = 1
d[bad] = 1
none[0] = 1
l[0] = 1
l[none] = 1
del none.attr
del o.attr
del d["k"]
del l[0]
del none[0]
del undefined
x = undefined
x = undefined + 1
undefined()
undefined.attr
a, b = 1
a, b = 1, 2, 3
a, b = [1]
a, *b = none
a, *b, c = [1]
[a, b] = none
(a, b), c = 1, 2
for a, b in [1]: pass
x = y = none.a
x: int = none.a
x += 1
l += none
d["k"] += 1
none.a += 1
o.a += 1
l[0] += 1
zero /= zero
for x in none: pass
for x in bad: pass
for x in BadNext(): pass
for x in [1]: x.a
for x in [1]:
    pass
else:
    none.a
while bad: pass
while 1:
    none.a
if bad: pass
if 0: pass
elif bad: pass
if none.a: pass
with none: pass
with bad: pass
with BadExit(): pass
with BadExit() as x, bad: pass
with (BadExit() as x,
      bad as y): pass
with BadExit():
    x = 1
with open(none) as f: pass
with BadExit() as none.a: pass
raise ValueError
raise ValueError("x")
raise ValueError("x") from none.a
raise none
raise ValueError from 1
raise
assert zero
assert zero, "message"
assert zero, none.a
assert none.a
import no_such_module_at_all
import os.no_such_submodule
from os import no_such_name
from no_such_module_at_all import x
from os import (path,
                no_such_name)
import os, no_such_module_at_all
try:
    1 / zero
except none: pass
try:
    1 / zero
except (ValueError, 3): pass
try:
    1 / zero
except ZeroDivisionError:
    none.a
try:
    1 / zero
finally:
    none.a
try:
    pass
except ValueError: pass
else:
    none.a
try:
    1 / zero
except* none: pass
try:
    raise ExceptionGroup("g", [ValueError()])
except* ValueError:
    none.a
def f(): none.a
f()
def f(a): pass
f()
def f(a): pass
f(1, 2)
def f(a): pass
f(b=1)
def f(a=none.a): pass
def f(a: none.a): pass
f.__annotations__
def f() -> none.a: pass
f.__annotations__
@none
def f(): pass
@none.a
def f(): pass
@len
@none
def f(): pass
class C(none): pass
class C(none.a): pass
class C(metaclass=none.a): pass
class C:
    x = none.a
class C:
    def m(self): return self.nothing
C().m()
@none
class C: pass
class C:
    x: none.a
C.__annotations__
def g():
    yield none.a
list(g())
def g():
    yield from none
list(g())
def g():
    x = yield
    x.a
i = g(); next(i); i.send(1)
def g():
    return (yield)
next(g()).a
async def c(): await none
c().send(None)
async def c(): await bad
c().send(None)
async def c():
    async with none: pass
c().send(None)
async def c():
    async for x in none: pass
c().send(None)
async def c():
    return [x async for x in none]
c().send(None)
match none.a:
    case 1: pass
match 1:
    case none.a: pass
match 1:
    case x if x.a: pass
match bad:
    case 1: pass
match {}:
    case {none.a: 1}: pass
match 1:
    case int(real=none.a): pass
match 1:
    case undefined(): pass
match 1:
    case 1:
        none.a
x = (y := none.a)
x = [y := 1, y.a]
print(none.a, sep="")
print(1, sep=none.a)
print(*none)
print(**none)
print(1, *none, 2)
print(a=1, **none)
print(*[1], **none)
o.m(*none)
o.m(**none)
type X = none.a
X.__value__
type X[T: none.a] = T
X.__type_params__[0].__bound__
def f[T: none.a](): pass
f.__type_params__[0].__bound__
class C[T = none.a]: pass
C.__type_params__[0].__default__
global_name = 1; del global_name; global_name
x = 1; x.real.imag.nothing
x = "ä" + none
x = "ääää"; y = "ö" + x.nothing
x = "日本語" + none + "x"
ä = none; ä.ö
x = [1,
     2,
     none.a,
     3]
x = {"a": 1,
     "b": none.a}
x = len(
    none
)
x = (
    1
    +
    none
)
x = o.a \
    .b
x = t"{none.a}"
lazy import no_such_module_at_all
no_such_module_at_all
'''
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: SNIPPETS = r''' x = 1 + none x = none + 1 + 2 x = 1 + 2 + none x = (1...")
try: chunk = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: chunk = []')
try:
    for line in SNIPPETS.strip("\n").split("\n"):
        # A snippet goes on while lines are indented, or continue a compound statement, or follow a definition.
        try: starts_new = chunk and not line.startswith((" ", "else", "elif", "except", "finally", "case", ")", "]", "}")) \
        and not chunk[0].startswith(("def ", "async def ", "class ", "@", "type ", "lazy ")) and not chunk[-1].endswith(("\\", "(", ",", "["))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: starts_new = chunk and not line.startswith((" ", "else", "elif", "exc...')
        if chunk and chunk[0].startswith(("def ", "async def ", "class ", "@", "type ", "lazy ")) and not line.startswith((" ", "@", "def ", "class ")) :
            try: chunk.append(line)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: chunk.append(line)')
            try: where("\n".join(chunk) + "\n")
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: where("\\n".join(chunk) + "\\n")')
            try: chunk = []
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: chunk = []')
            continue
        if starts_new:
            try: where("\n".join(chunk) + "\n")
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: where("\\n".join(chunk) + "\\n")')
            try: chunk = []
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: chunk = []')
        try: chunk.append(line)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: chunk.append(line)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for line in SNIPPETS.strip("\\n").split("\\n"):')
try:
    if chunk:
        try: where("\n".join(chunk) + "\n")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: where("\\n".join(chunk) + "\\n")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if chunk:')
