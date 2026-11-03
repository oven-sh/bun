def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

try:
    print("body")
except ValueError:
    print("not reached")
try:
    raise ValueError("v")
except ValueError:
    print("caught")
try:
    raise ValueError("v")
except ValueError as e:
    print("caught", e, type(e), e.args)
try:
    raise KeyError("k")
except (ValueError, KeyError) as e:
    print("tuple", repr(e))
try:
    raise IndexError("i")
except ValueError: print("no")
except LookupError as e: print("base class", repr(e))
except IndexError: print("too late")
try:
    1 / 0
except: print("bare except")
try:
    pass
except ValueError: print("no")
else: print("else runs")
try:
    raise ValueError
except ValueError: print("caught")
else: print("else does not run")
try:
    print("try", end="; ")
finally: print("finally")
try:
    try: raise ValueError("inner")
    finally: print("inner finally", end="; ")
except ValueError as e: print("outer caught", e)
try:
    print("t", end="; ")
except ValueError: print("x")
else: print("e", end="; ")
finally: print("f")
try:
    try: raise KeyError("a")
    except ValueError: print("wrong")
except KeyError as e: print("propagated", e)
try:
    try: raise ValueError("first")
    except ValueError: raise KeyError("second")
except KeyError as e: print("replaced", e, repr(e.__context__))
try:
    try: raise ValueError("again")
    except ValueError: raise
except ValueError as e: print("re-raised", e)
try:
    try: pass
    except KeyError: pass
    else: raise ValueError("from else")
    finally: print("fin", end="; ")
except ValueError as e: print(e)
try:
    try: raise ValueError("a")
    except ValueError: pass
    else: print("no")
    finally: raise KeyError("from finally")
except KeyError as e: print(e, e.__context__)
try:
    try: raise ValueError("lost")
    finally: raise KeyError("wins")
except KeyError as e: print(e, repr(e.__context__))
# return, break, continue in try/finally.
def r1():
    try: return "try"
    finally: print("finally runs", end="; ")
def r2():
    try: return "try"
    finally: return "finally wins"
def r3():
    try: raise ValueError
    finally: return "swallowed"
def r4():
    try: raise ValueError
    except ValueError: return "except"
    finally: print("fin", end="; ")
def r5():
    try: pass
    except ValueError: pass
    else: return "else"
    finally: print("fin", end="; ")
def r6():
    x = 1
    try: return x
    finally: x = 2
def r7():
    l = [1]
    try: return l
    finally: l.append(2)
def r8():
    for i in range(3):
        try: return i
        finally: print("f", i, end="; ")
def r9():
    try:
        try: return "inner"
        finally: print("f1", end="; ")
    finally: print("f2", end="; ")
def r10():
    try:
        try: return "inner"
        finally: return "middle"
    finally: print("outer fin", end="; ")
def r11():
    try: return print("evaluated before finally", end="; ")
    finally: print("then finally", end="; ")
def r12():
    try: raise ValueError("x")
    except ValueError as e: return e
    finally: pass
for f in (r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12): print(repr(f()))
def b1():
    out = []
    for i in range(5):
        try:
            if i == 1: continue
            if i == 3: break
            out.append(i)
        finally: out.append("f%d" % i)
    else: out.append("else")
    return out
def b2():
    out = []
    for i in range(3):
        try: raise ValueError
        except ValueError:
            out.append(i); continue
        finally: out.append("f")
        out.append("unreachable")
    return out
def b3():
    for i in range(3):
        try: raise ValueError("swallowed by break")
        finally: break
    return i
def b4():
    out = []
    for i in range(3):
        try: raise ValueError("swallowed by continue")
        finally:
            out.append(i); continue
    return out
def b5():
    i = 0
    while True:
        try:
            i += 1
            if i > 3: break
        finally: i += 10
    return i
def b6():
    out = []
    for i in range(2):
        for j in range(3):
            try:
                if j == 1: break
            finally: out.append((i, j))
    return out
def b7():
    for i in range(3):
        try: return "return"
        finally: break
    return "break overrides return"
def b8():
    out = []
    for i in range(3):
        try:
            try: continue
            finally: out.append("inner")
        finally: out.append("outer")
    return out
def b9():
    out = []
    for i in range(3):
        try: pass
        except: pass
        else:
            if i == 1: break
        finally: out.append(i)
    return out
for f in (b1, b2, b3, b4, b5, b6, b7, b8, b9): print(f())
# The name bound by `as` is deleted at the end of the clause.
e = "before"
try: raise ValueError("x")
except ValueError as e: pass
t(lambda: e)
def scope():
    e = "before"
    try: raise ValueError
    except ValueError as e: inner = e
    try: return e
    except UnboundLocalError as u: return str(u), type(inner).__name__
print(scope())
def scope2():
    try: raise ValueError
    except ValueError as e:
        del e
    return "deleting it oneself is fine"
print(scope2())
def scope3():
    try: pass
    except ValueError as e: pass
    return e
t(scope3)
def scope4():
    for i in range(2):
        try: raise ValueError(i)
        except ValueError as e:
            if i == 0: continue
            return e.args
print(scope4())
# What can follow except.
t(lambda: exec("try: raise ValueError\nexcept 1: pass"))
t(lambda: exec("try: raise ValueError\nexcept 'ValueError': pass"))
t(lambda: exec("try: raise ValueError\nexcept (ValueError, 1): pass"))
t(lambda: exec("try: raise ValueError\nexcept (1, ValueError): pass"))
t(lambda: exec("try: raise ValueError\nexcept None: pass"))
t(lambda: exec("try: raise ValueError\nexcept [ValueError]: pass"))
t(lambda: exec("try: raise ValueError\nexcept int: pass"))
t(lambda: exec("try: raise ValueError\nexcept (): pass"))
t(lambda: exec("try: raise ValueError\nexcept ValueError(): pass"))
t(lambda: exec("try: raise ValueError\nexcept undefined_name: pass"))
t(lambda: exec("try: pass\nexcept undefined_name: pass\nprint('not evaluated without an exception')"))
t(lambda: exec("try: raise ValueError\nexcept ((KeyError, (ValueError,)),): print('nested tuples')"))
t(lambda: exec("try: raise ValueError\nexcept KeyError, ValueError: print('no parentheses, 3.14')"))
t(lambda: exec("try: raise ValueError\nexcept object: pass"))
def order():
    def ex(n, c): print("eval", n, end="; "); return c
    try: raise KeyError
    except ex(1, ValueError): pass
    except ex(2, KeyError): print("matched 2", end="; ")
    except ex(3, Exception): pass
order(); print()
class Meta(type):
    def __instancecheck__(c, o): print("instancecheck not used"); return True
    def __subclasscheck__(c, s): print("subclasscheck not used"); return True
class Fake(Exception, metaclass=Meta): pass
try:
    try: raise ValueError("v")
    except Fake: print("wrongly caught")
except ValueError: print("except uses the real MRO")
for src in ("try: pass", "try: pass\nelse: pass", "try: pass\nexcept: pass\nexcept ValueError: pass", "try: pass\nfinally: pass\nexcept: pass", "try: pass\nexcept: pass\nfinally: pass\nelse: pass", "try: pass\nfinally: pass\nfinally: pass", "try: pass\nexcept ValueError as 1: pass", "try: pass\nexcept ValueError as a.b: pass", "try: pass\nexcept ValueError as (a, b): pass", "try: pass\nexcept as e: pass", "try: pass\nexcept ValueError, KeyError as e: pass", "try: pass\nexcept (ValueError, KeyError) as e: pass", "try: pass\nexcept ValueError e: pass", "except: pass", "finally: pass", "try:\npass\nexcept: pass", "try: pass\nexcept ValueError as None: pass", "try: pass\nexcept *: pass", "try: pass\nexcept: pass\nelse: pass\nelse: pass", "try: pass\nexcept ValueError:", "try: pass\nexcept ValueError as e as f: pass", "try: pass\nexcept a if b else c: pass", "try: pass\nexcept lambda: 1: pass", "try: pass\nexcept *a, b: pass", "try: pass\nexcept ValueError as __debug__: pass", "try: x = 1\nexcept ValueError, : pass", "def f():\n try: pass\n finally: return", "for i in x:\n try: pass\n finally: continue", "for i in x:\n try: pass\n finally: break", "try: pass\nfinally: continue", "try: continue\nfinally: pass", "try: break\nexcept: pass"):
    try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
    except SyntaxError as ex: print("SyntaxError:", ex.msg)
# Deep nesting.
def deep(n):
    if n == 0: raise ValueError("bottom")
    try: deep(n - 1)
    finally: trail.append(n)
trail = []
try: deep(5)
except ValueError as ex: print(ex, trail)
def many_handlers(x):
    try: raise x
    except ZeroDivisionError: return 1
    except KeyError: return 2
    except IndexError: return 3
    except (TypeError, ValueError): return 4
    except OSError: return 5
    except Exception: return 6
    except BaseException: return 7
print([many_handlers(c) for c in (ZeroDivisionError, KeyError, IndexError, TypeError, ValueError, FileNotFoundError, RuntimeError, KeyboardInterrupt, SystemExit, GeneratorExit, UnicodeDecodeError("a", b"", 0, 1, "r"), StopIteration, ArithmeticError, LookupError)])
