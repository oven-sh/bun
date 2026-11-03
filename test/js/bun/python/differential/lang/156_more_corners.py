import weakref, gc, functools, builtins
# callbacks latest first
class A: pass
a = A(); res = []
refs = [weakref.ref(a, lambda r, i=i: res.append(i)) for i in range(5)]
del a; gc.collect(); print(res)
a = A(); res = []
f1 = weakref.finalize(a, res.append, 'f1'); f2 = weakref.finalize(a, res.append, 'f2'); f3 = weakref.finalize(a, res.append, 'f3')
del a; gc.collect(); print(res)
# float() of text that has a __float__
class FooStr(str):
    def __float__(self): return float(str(self)) + 1
class FooBytes(bytes):
    def __float__(self): return 3.5
class PlainStr(str): pass
print(float(FooStr('8')), float(FooBytes(b'8')), float(PlainStr('8')))
# iter(callable, sentinel) that is exhausted by the call
def spam():
    if spam.recursive: return 2
    spam.recursive = True
    list(spam.iterator)
    return 1
spam.recursive = False
spam.iterator = iter(spam, 2)
print(next(spam.iterator, "stopped"))
# a builtin found through a key that is no str
class CustomStr:
    def __init__(self, name): self.name = name
    def __hash__(self): return hash(self.name)
    def __eq__(self, other): return other == self.name
orig = builtins.__dict__.pop("divmod")
builtins.__dict__[CustomStr("divmod")] = orig
try:
    print(divmod(7, 2), eval("divmod(9, 2)"))
    def inner(): return divmod(11, 2)
    print(inner(), inner())
finally:
    del builtins.__dict__[CustomStr("divmod")]
    builtins.divmod = orig
try: nosuchname
except NameError as e: print(e)
import ast
for src in ("def foo():  # type: () -> int\n    # type: () -> int\n    return ''\n", "def foo():  # type: () -> int\n    return ''\n", "def foo():\n    # type: () -> int\n    return ''\n"):
    try: print(ast.parse(src, type_comments=True).body[0].type_comment)
    except SyntaxError as e: print(e.msg, e.lineno, e.offset, e.end_lineno, e.end_offset)
import collections, itertools
for t in (int, collections.deque, itertools.count, functools.partial, type("C", (), {})):
    try: t.nosuch
    except AttributeError as e: print(e)
