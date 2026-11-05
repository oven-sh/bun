# frame.f_lineno = n, from every line to every other line of functions with handlers. The line of `except` is further in than its clause: from there a frame can go on in
# any of the clauses, with the exception still being handled, and from a clause there is no way back to it.
import sys, warnings
warnings.simplefilter("ignore")
SRC = {
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
for name, src in SRC.items():
    n = src.count('\n') - 1
    for a in range(1, n):
        for b in range(1, n):
            if a == b: continue
            # (Where CPython goes on from a handler to the line of a `for` is an accident of its code.)
            if name == 'in_a_loop' and b == 1 and a in (4, 5): continue
            ns = {'sys': sys}
            exec(compile(src, '<j>', 'exec'), ns)
            f = ns['f']; out = []; done = [False]; first = f.__code__.co_firstlineno
            def tr(fr, e, arg):
                if fr.f_code is not f.__code__: return None
                if e == 'line' and not done[0] and fr.f_lineno - first == a:
                    done[0] = True
                    try:
                        fr.f_lineno = first + b
                    except ValueError as x:
                        out.append(('refused', str(x)))
                return tr
            sys.settrace(tr)
            try:
                f(out)
            except BaseException as x:
                out.append(('raised', type(x).__name__))
            finally:
                sys.settrace(None)
            print(name, a, b, out if len(out) < 30 else out[:30])
