# frame.f_lineno = n, from every line to every other line of functions with handlers. The line of `except` is further in than its clause: from there a frame can go on in
# any of the clauses, with the exception still being handled, and from a clause there is no way back to it.
try: import sys, warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, warnings')
try: warnings.simplefilter("ignore")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: warnings.simplefilter("ignore")')
try: SRC = {
'try_except': '''
def f(out):
    out.append(1)
    try:
        out.append(3)
        raise ValueError
    except ValueError:
        out.append(6)
        out.append(('h', type(sys.exception()).__name__))
    out.append(8)
''',
'try_except_as': '''
def f(out):
    out.append(1)
    try:
        out.append(3)
        raise ValueError
    except ValueError as e:
        out.append(6)
        out.append(('h', type(sys.exception()).__name__))
    out.append(8)
''',
'two_clauses': '''
def f(out):
    out.append(1)
    try:
        out.append(3)
        raise ValueError
    except KeyError:
        out.append(6)
    except ValueError:
        out.append(8)
        out.append(('h', type(sys.exception()).__name__))
    out.append(10)
''',
'try_finally': '''
def f(out):
    out.append(1)
    try:
        out.append(3)
    finally:
        out.append(5)
        out.append(6)
    out.append(7)
''',
'nested': '''
def f(out):
    try:
        raise ValueError
    except ValueError:
        out.append(4)
        try:
            raise KeyError
        except KeyError:
            out.append(8)
            out.append(('h', type(sys.exception()).__name__))
        out.append(('h', type(sys.exception()).__name__))
    out.append(11)
''',
'in_a_loop': '''
def f(out):
    for i in (1, 2):
        try:
            raise ValueError
        except ValueError:
            out.append(5)
        out.append(6)
    out.append(7)
''',
'else_and_finally': '''
def f(out):
    try:
        out.append(2)
    except ValueError:
        out.append(4)
    else:
        out.append(6)
    finally:
        out.append(8)
    out.append(9)
''',
'bare': '''
def f(out):
    out.append(1)
    try:
        out.append(3)
        raise ValueError
    except:
        out.append(6)
        out.append(('h', type(sys.exception()).__name__))
    out.append(8)
''',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: SRC = { 'try_except': ''' def f(out): out.append(1) try: out.append(3...")
try:
    for name, src in SRC.items():
        try: n = src.count('\n') - 1
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: n = src.count('\\n') - 1")
        for a in range(1, n):
            for b in range(1, n):
                if a == b: continue
                # (Where CPython goes on from a handler to the line of a `for` is an accident of its code.)
                if name == 'in_a_loop' and b == 1 and a in (4, 5): continue
                try: ns = {'sys': sys}
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ns = {'sys': sys}")
                try: exec(compile(src, '<j>', 'exec'), ns)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec(compile(src, '<j>', 'exec'), ns)")
                try: f = ns['f']
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: f = ns['f']")
                try: out = []
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out = []')
                try: done = [False]
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: done = [False]')
                try: first = f.__code__.co_firstlineno
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first = f.__code__.co_firstlineno')
                def tr(fr, e, arg):
                    if fr.f_code is not f.__code__: return None
                    if e == 'line' and not done[0] and fr.f_lineno - first == a:
                        done[0] = True
                        try:
                            fr.f_lineno = first + b
                        except ValueError as x:
                            out.append(('refused', str(x)))
                    return tr
                try: sys.settrace(tr)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(tr)')
                try:
                    f(out)
                except BaseException as x:
                    out.append(('raised', type(x).__name__))
                finally:
                    sys.settrace(None)
                try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + ", " + 'a=' + (repr(a) if type(a) in (str, int, float, bytes, bool, type(None)) or (type(a) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in a)) else a.__name__ if type(a) is type else type(a).__name__) + ", " + 'b=' + (repr(b) if type(b) in (str, int, float, bytes, bool, type(None)) or (type(b) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in b)) else b.__name__ if type(b) is type else type(b).__name__) + '] =>', name)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
                try: print('a [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + ", " + 'a=' + (repr(a) if type(a) in (str, int, float, bytes, bool, type(None)) or (type(a) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in a)) else a.__name__ if type(a) is type else type(a).__name__) + ", " + 'b=' + (repr(b) if type(b) in (str, int, float, bytes, bool, type(None)) or (type(b) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in b)) else b.__name__ if type(b) is type else type(b).__name__) + '] =>', a)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a')
                try: print('b [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + ", " + 'a=' + (repr(a) if type(a) in (str, int, float, bytes, bool, type(None)) or (type(a) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in a)) else a.__name__ if type(a) is type else type(a).__name__) + ", " + 'b=' + (repr(b) if type(b) in (str, int, float, bytes, bool, type(None)) or (type(b) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in b)) else b.__name__ if type(b) is type else type(b).__name__) + '] =>', b)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b')
                try: print('out if len(out) < 30 else out[:30] [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + ", " + 'a=' + (repr(a) if type(a) in (str, int, float, bytes, bool, type(None)) or (type(a) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in a)) else a.__name__ if type(a) is type else type(a).__name__) + ", " + 'b=' + (repr(b) if type(b) in (str, int, float, bytes, bool, type(None)) or (type(b) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in b)) else b.__name__ if type(b) is type else type(b).__name__) + '] =>', out if len(out) < 30 else out[:30])
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: out if len(out) < 30 else out[:30]')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name, src in SRC.items():')
