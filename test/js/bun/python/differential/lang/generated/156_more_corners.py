try: import weakref, gc, functools, builtins
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import weakref, gc, functools, builtins')
# callbacks latest first
try:
    class A: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A: pass')
try: a = A()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = A()')
try: res = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: res = []')
try: refs = [weakref.ref(a, lambda r, i=i: res.append(i)) for i in range(5)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: refs = [weakref.ref(a, lambda r, i=i: res.append(i)) for i in range(5)]')
try: del a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del a')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print(res)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: res')
try: a = A()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = A()')
try: res = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: res = []')
try: f1 = weakref.finalize(a, res.append, 'f1')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: f1 = weakref.finalize(a, res.append, 'f1')")
try: f2 = weakref.finalize(a, res.append, 'f2')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: f2 = weakref.finalize(a, res.append, 'f2')")
try: f3 = weakref.finalize(a, res.append, 'f3')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: f3 = weakref.finalize(a, res.append, 'f3')")
try: del a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del a')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print(res)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: res')
# float() of text that has a __float__
try:
    class FooStr(str):
        def __float__(self): return float(str(self)) + 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class FooStr(str):')
try:
    class FooBytes(bytes):
        def __float__(self): return 3.5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class FooBytes(bytes):')
try:
    class PlainStr(str): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class PlainStr(str): pass')
try: print("float(FooStr('8')) =>", float(FooStr('8')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: float(FooStr('8'))")
try: print("float(FooBytes(b'8')) =>", float(FooBytes(b'8')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: float(FooBytes(b'8'))")
try: print("float(PlainStr('8')) =>", float(PlainStr('8')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: float(PlainStr('8'))")
# iter(callable, sentinel) that is exhausted by the call
try:
    def spam():
        if spam.recursive: return 2
        spam.recursive = True
        list(spam.iterator)
        return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def spam():')
try: spam.recursive = False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: spam.recursive = False')
try: spam.iterator = iter(spam, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: spam.iterator = iter(spam, 2)')
try: print(next(spam.iterator, "stopped"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(spam.iterator, "stopped")')
# a builtin found through a key that is no str
try:
    class CustomStr:
        def __init__(self, name): self.name = name
        def __hash__(self): return hash(self.name)
        def __eq__(self, other): return other == self.name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CustomStr:')
try: orig = builtins.__dict__.pop("divmod")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: orig = builtins.__dict__.pop("divmod")')
try: builtins.__dict__[CustomStr("divmod")] = orig
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: builtins.__dict__[CustomStr("divmod")] = orig')
try:
    try:
        print('divmod(7, 2) =>', divmod(7, 2))
        print('eval("divmod(9, 2)") =>', eval("divmod(9, 2)"))
        def inner(): return divmod(11, 2)
        print('inner() =>', inner())
        print('inner() =>', inner())
    finally:
        del builtins.__dict__[CustomStr("divmod")]
        builtins.divmod = orig
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try: nosuchname
    except NameError as e: print(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: nosuchname')
try: import ast
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import ast')
try:
    for src in ("def foo():  # type: () -> int\n    # type: () -> int\n    return ''\n", "def foo():  # type: () -> int\n    return ''\n", "def foo():\n    # type: () -> int\n    return ''\n"):
        try: print(ast.parse(src, type_comments=True).body[0].type_comment)
        except SyntaxError as e: print(e.msg, e.lineno, e.offset, e.end_lineno, e.end_offset)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("def foo(): # type: () -> int\\n # type: () -> int\\n retur...')
try: import collections, itertools
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import collections, itertools')
try:
    for t in (int, collections.deque, itertools.count, functools.partial, type("C", (), {})):
        try: t.nosuch
        except AttributeError as e: print(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for t in (int, collections.deque, itertools.count, functools.partial,...')
