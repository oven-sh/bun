try:
    def t(f):
        try:
            print(repr(f()))
        except BaseException as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
    try:
        print("body")
    except ValueError:
        print("not reached")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        raise ValueError("v")
    except ValueError:
        print("caught")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        raise ValueError("v")
    except ValueError as e:
        print("caught", 'e =>', e)
        print('type(e) =>', type(e))
        print('e.args =>', e.args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        raise KeyError("k")
    except (ValueError, KeyError) as e:
        print("tuple", 'repr(e) =>', repr(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        raise IndexError("i")
    except ValueError: print("no")
    except LookupError as e: print("base class", repr(e))
    except IndexError: print("too late")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        1 / 0
    except: print("bare except")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        pass
    except ValueError: print("no")
    else: print("else runs")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        raise ValueError
    except ValueError: print("caught")
    else: print("else does not run")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        print("try", end="; ")
    finally: print("finally")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        try: raise ValueError("inner")
        finally: print("inner finally", end="; ")
    except ValueError as e: print("outer caught", e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        print("t", end="; ")
    except ValueError: print("x")
    else: print("e", end="; ")
    finally: print("f")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        try: raise KeyError("a")
        except ValueError: print("wrong")
    except KeyError as e: print("propagated", e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        try: raise ValueError("first")
        except ValueError: raise KeyError("second")
    except KeyError as e: print("replaced", e, repr(e.__context__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        try: raise ValueError("again")
        except ValueError: raise
    except ValueError as e: print("re-raised", e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        try: pass
        except KeyError: pass
        else: raise ValueError("from else")
        finally: print("fin", end="; ")
    except ValueError as e: print(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        try: raise ValueError("a")
        except ValueError: pass
        else: print("no")
        finally: raise KeyError("from finally")
    except KeyError as e: print(e, e.__context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    try:
        try: raise ValueError("lost")
        finally: raise KeyError("wins")
    except KeyError as e: print(e, repr(e.__context__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
# return, break, continue in try/finally.
try:
    def r1():
        try: return "try"
        finally: print("finally runs", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r1():')
try:
    def r2():
        try: return "try"
        finally: return "finally wins"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r2():')
try:
    def r3():
        try: raise ValueError
        finally: return "swallowed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r3():')
try:
    def r4():
        try: raise ValueError
        except ValueError: return "except"
        finally: print("fin", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r4():')
try:
    def r5():
        try: pass
        except ValueError: pass
        else: return "else"
        finally: print("fin", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r5():')
try:
    def r6():
        x = 1
        try: return x
        finally: x = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r6():')
try:
    def r7():
        l = [1]
        try: return l
        finally: l.append(2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r7():')
try:
    def r8():
        for i in range(3):
            try: return i
            finally: print("f", i, end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r8():')
try:
    def r9():
        try:
            try: return "inner"
            finally: print("f1", end="; ")
        finally: print("f2", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r9():')
try:
    def r10():
        try:
            try: return "inner"
            finally: return "middle"
        finally: print("outer fin", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r10():')
try:
    def r11():
        try: return print("evaluated before finally", end="; ")
        finally: print("then finally", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r11():')
try:
    def r12():
        try: raise ValueError("x")
        except ValueError as e: return e
        finally: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def r12():')
try:
    for f in (r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12): print(repr(f()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12): print(r...')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b1():')
try:
    def b2():
        out = []
        for i in range(3):
            try: raise ValueError
            except ValueError:
                out.append(i); continue
            finally: out.append("f")
            out.append("unreachable")
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b2():')
try:
    def b3():
        for i in range(3):
            try: raise ValueError("swallowed by break")
            finally: break
        return i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b3():')
try:
    def b4():
        out = []
        for i in range(3):
            try: raise ValueError("swallowed by continue")
            finally:
                out.append(i); continue
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b4():')
try:
    def b5():
        i = 0
        while True:
            try:
                i += 1
                if i > 3: break
            finally: i += 10
        return i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b5():')
try:
    def b6():
        out = []
        for i in range(2):
            for j in range(3):
                try:
                    if j == 1: break
                finally: out.append((i, j))
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b6():')
try:
    def b7():
        for i in range(3):
            try: return "return"
            finally: break
        return "break overrides return"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b7():')
try:
    def b8():
        out = []
        for i in range(3):
            try:
                try: continue
                finally: out.append("inner")
            finally: out.append("outer")
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b8():')
try:
    def b9():
        out = []
        for i in range(3):
            try: pass
            except: pass
            else:
                if i == 1: break
            finally: out.append(i)
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b9():')
try:
    for f in (b1, b2, b3, b4, b5, b6, b7, b8, b9): print(f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (b1, b2, b3, b4, b5, b6, b7, b8, b9): print(f())')
# The name bound by `as` is deleted at the end of the clause.
try: e = "before"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = "before"')
try:
    try: raise ValueError("x")
    except ValueError as e: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: raise ValueError("x")')
try: print('e =>', end=" "); t(lambda: e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: e)')
try:
    def scope():
        e = "before"
        try: raise ValueError
        except ValueError as e: inner = e
        try: return e
        except UnboundLocalError as u: return str(u), type(inner).__name__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def scope():')
try: print(scope())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: scope()')
try:
    def scope2():
        try: raise ValueError
        except ValueError as e:
            del e
        return "deleting it oneself is fine"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def scope2():')
try: print(scope2())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: scope2()')
try:
    def scope3():
        try: pass
        except ValueError as e: pass
        return e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def scope3():')
try: print('scope3() =>', end=" "); t(scope3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(scope3)')
try:
    def scope4():
        for i in range(2):
            try: raise ValueError(i)
            except ValueError as e:
                if i == 0: continue
                return e.args
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def scope4():')
try: print(scope4())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: scope4()')
# What can follow except.
try: print('exec("try: raise ValueError\\nexcept 1: pass") =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept 1: pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept 1: pass"))')
try: print('exec("try: raise ValueError\\nexcept \'ValueError\': pass") =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept 'ValueError': pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept \'ValueError\': pass"))')
try: print('exec("try: raise ValueError\\nexcept (ValueError, 1): pass") =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept (ValueError, 1): pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept (ValueError, 1): pass"))')
try: print('exec("try: raise ValueError\\nexcept (1, ValueError): pass") =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept (1, ValueError): pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept (1, ValueError): pass"))')
try: print('exec("try: raise ValueError\\nexcept None: pass") =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept None: pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept None: pass"))')
try: print('exec("try: raise ValueError\\nexcept [ValueError]: pass") =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept [ValueError]: pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept [ValueError]: pass"))')
try: print('exec("try: raise ValueError\\nexcept int: pass") =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept int: pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept int: pass"))')
try: print('exec("try: raise ValueError\\nexcept (): pass") =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept (): pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept (): pass"))')
try: print('exec("try: raise ValueError\\nexcept ValueError(): pass") =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept ValueError(): pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept ValueError(): pass"))')
try: print('exec("try: raise ValueError\\nexcept undefined_name: pass") =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept undefined_name: pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept undefined_name: pass"))')
try: print('exec("try: pass\\nexcept undefined_name: pass\\nprint(\'not evaluated wi... =>', end=" "); t(lambda: exec("try: pass\nexcept undefined_name: pass\nprint('not evaluated without an exception')"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: pass\\nexcept undefined_name: pass\\nprint(\'not ev...')
try: print('exec("try: raise ValueError\\nexcept ((KeyError, (ValueError,)),): pri... =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept ((KeyError, (ValueError,)),): print('nested tuples')"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept ((KeyError, (ValueError...')
try: print('exec("try: raise ValueError\\nexcept KeyError, ValueError: print(\'no p... =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept KeyError, ValueError: print('no parentheses, 3.14')"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept KeyError, ValueError: p...')
try: print('exec("try: raise ValueError\\nexcept object: pass") =>', end=" "); t(lambda: exec("try: raise ValueError\nexcept object: pass"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("try: raise ValueError\\nexcept object: pass"))')
try:
    def order():
        def ex(n, c): print("eval", n, end="; "); return c
        try: raise KeyError
        except ex(1, ValueError): pass
        except ex(2, KeyError): print("matched 2", end="; ")
        except ex(3, Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def order():')
try: order()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: order()')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    class Meta(type):
        def __instancecheck__(c, o): print("instancecheck not used"); return True
        def __subclasscheck__(c, s): print("subclasscheck not used"); return True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Meta(type):')
try:
    class Fake(Exception, metaclass=Meta): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Fake(Exception, metaclass=Meta): pass')
try:
    try:
        try: raise ValueError("v")
        except Fake: print("wrongly caught")
    except ValueError: print("except uses the real MRO")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    for src in ("try: pass", "try: pass\nelse: pass", "try: pass\nexcept: pass\nexcept ValueError: pass", "try: pass\nfinally: pass\nexcept: pass", "try: pass\nexcept: pass\nfinally: pass\nelse: pass", "try: pass\nfinally: pass\nfinally: pass", "try: pass\nexcept ValueError as 1: pass", "try: pass\nexcept ValueError as a.b: pass", "try: pass\nexcept ValueError as (a, b): pass", "try: pass\nexcept as e: pass", "try: pass\nexcept ValueError, KeyError as e: pass", "try: pass\nexcept (ValueError, KeyError) as e: pass", "try: pass\nexcept ValueError e: pass", "except: pass", "finally: pass", "try:\npass\nexcept: pass", "try: pass\nexcept ValueError as None: pass", "try: pass\nexcept *: pass", "try: pass\nexcept: pass\nelse: pass\nelse: pass", "try: pass\nexcept ValueError:", "try: pass\nexcept ValueError as e as f: pass", "try: pass\nexcept a if b else c: pass", "try: pass\nexcept lambda: 1: pass", "try: pass\nexcept *a, b: pass", "try: pass\nexcept ValueError as __debug__: pass", "try: x = 1\nexcept ValueError, : pass", "def f():\n try: pass\n finally: return", "for i in x:\n try: pass\n finally: continue", "for i in x:\n try: pass\n finally: break", "try: pass\nfinally: continue", "try: continue\nfinally: pass", "try: break\nexcept: pass"):
        try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
        except SyntaxError as ex: print("SyntaxError:", ex.msg)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("try: pass", "try: pass\\nelse: pass", "try: pass\\nexcept:...')
# Deep nesting.
try:
    def deep(n):
        if n == 0: raise ValueError("bottom")
        try: deep(n - 1)
        finally: trail.append(n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def deep(n):')
try: trail = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: trail = []')
try:
    try: deep(5)
    except ValueError as ex: print(ex, trail)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: deep(5)')
try:
    def many_handlers(x):
        try: raise x
        except ZeroDivisionError: return 1
        except KeyError: return 2
        except IndexError: return 3
        except (TypeError, ValueError): return 4
        except OSError: return 5
        except Exception: return 6
        except BaseException: return 7
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def many_handlers(x):')
try: print([many_handlers(c) for c in (ZeroDivisionError, KeyError, IndexError, TypeError, ValueError, FileNotFoundError, RuntimeError, KeyboardInterrupt, SystemExit, GeneratorExit, UnicodeDecodeError("a", b"", 0, 1, "r"), StopIteration, ArithmeticError, LookupError)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [many_handlers(c) for c in (ZeroDivisionError, KeyError, IndexError, ...')
