# A statement that ends with a branch, in front of a jump that leads to a jump: at the end of an arm of an `if` with an `else` that a `case`,
# the body of a `try` or another arm ends with. CPython's compiler has a branch to a jump go where the jump goes if the jump is of one kind,
# and not if it is of the other, whatever that one comes to lead to.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: M = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M = sys.monitoring')
try: E = M.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E = M.events')

try:
    def record(function, *arguments):
        code = function.__code__
        line_at = {}
        for start, end, line in code.co_lines():
            for offset in range(start, end):
                line_at[offset] = line
        log = []
        M.use_tool_id(3, 't')
        for event, name in ((E.JUMP, 'J'), (E.BRANCH_LEFT, 'BL'), (E.BRANCH_RIGHT, 'BR')):
            M.register_callback(3, event, lambda c, a, b, name=name: log.append('%s%s>%s' % (name, line_at[a], line_at[b])))
        M.register_callback(3, E.LINE, lambda c, line: log.append('L%d' % line))
        M.set_local_events(3, code, E.JUMP | E.BRANCH_LEFT | E.BRANCH_RIGHT | E.LINE)
        try:
            try:
                result = function(*arguments)
            except AssertionError:
                result = 'AssertionError'
        finally:
            M.set_local_events(3, code, 0)
            M.free_tool_id(3)
        return '%s | %s' % (result, ' '.join(log))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def record(function, *arguments):')

try: SRC = '''
def f(a, b):
    match a:
        case 5:
            pass
        case int(w):
            if a:
                %s
            else:
                x = 1
        case _:
            x = 3
    y = [1, 2, 3, 4, 5, 6]
    z = len(y) + len(y) + len(y)
    return z
'''
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: SRC = ''' def f(a, b): match a: case 5: pass case int(w): if a: %s el...")
try: SRC2 = '''
def f(a, b):
    match a:
        case 5:
            pass
        case int(w):
            %s
        case _:
            x = 3
    y = [1, 2, 3, 4, 5, 6]
    z = len(y) + len(y) + len(y)
    return z
'''
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: SRC2 = ''' def f(a, b): match a: case 5: pass case int(w): %s case _:...")
try: SRC3 = '''
def f(a, b):
    for i in range(2):
        if a:
            if i:
                %s
            else:
                x = 1
        else:
            x = 3
        y = [1, 2, 3, 4, 5, 6]
    z = len(y) + len(y) + len(y)
    return z
'''
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: SRC3 = ''' def f(a, b): for i in range(2): if a: if i: %s else: x = 1...")
try: SRC4 = '''
def f(a, b):
    try:
        if a:
            %s
        else:
            x = 1
    except ValueError:
        x = 3
    y = [1, 2, 3, 4, 5, 6]
    z = len(y) + len(y) + len(y)
    return z
'''
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: SRC4 = ''' def f(a, b): try: if a: %s else: x = 1 except ValueError: ...")
try: BODY = {'assert': 'assert b', 'assert msg': 'assert b, a', 'if': 'if b: x = 2', 'if not': 'if not b: x = 2', 'assert or': 'assert b or a', 'assert and': 'assert b and a', 'assert not': 'assert not b', 'while': 'while b: b -= 1', 'if raise': 'if not b: raise AssertionError'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: BODY = {'assert': 'assert b', 'assert msg': 'assert b, a', 'if': 'if ...")
try:
    for sname, src in (('case if', SRC), ('case', SRC2), ('loop', SRC3), ('try', SRC4)):
        for name, body in BODY.items():
            try: ns = {}
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns = {}')
            try: exec(compile(src % body, 'm', 'exec'), ns)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec(compile(src % body, 'm', 'exec'), ns)")
            for args in ((1, 1), (0, 1), (2, 1), (1, 0), (0, 0)):
                try: print('sname [' + 'sname=' + (repr(sname) if type(sname) in (str, int, float, bytes, bool, type(None)) or (type(sname) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in sname)) else sname.__name__ if type(sname) is type else type(sname).__name__) + ", " + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'body=' + (repr(body) if type(body) in (str, int, float, bytes, bool, type(None)) or (type(body) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in body)) else body.__name__ if type(body) is type else type(body).__name__) + ", " + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + '] =>', sname)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sname')
                try: print('|', 'name [' + 'sname=' + (repr(sname) if type(sname) in (str, int, float, bytes, bool, type(None)) or (type(sname) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in sname)) else sname.__name__ if type(sname) is type else type(sname).__name__) + ", " + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'body=' + (repr(body) if type(body) in (str, int, float, bytes, bool, type(None)) or (type(body) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in body)) else body.__name__ if type(body) is type else type(body).__name__) + ", " + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + '] =>', name)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
                try: print('args [' + 'sname=' + (repr(sname) if type(sname) in (str, int, float, bytes, bool, type(None)) or (type(sname) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in sname)) else sname.__name__ if type(sname) is type else type(sname).__name__) + ", " + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'body=' + (repr(body) if type(body) in (str, int, float, bytes, bool, type(None)) or (type(body) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in body)) else body.__name__ if type(body) is type else type(body).__name__) + ", " + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + '] =>', args)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: args')
                try: print("record(ns['f'], *args) [" + 'sname=' + (repr(sname) if type(sname) in (str, int, float, bytes, bool, type(None)) or (type(sname) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in sname)) else sname.__name__ if type(sname) is type else type(sname).__name__) + ", " + 'src=' + (repr(src) if type(src) in (str, int, float, bytes, bool, type(None)) or (type(src) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in src)) else src.__name__ if type(src) is type else type(src).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'body=' + (repr(body) if type(body) in (str, int, float, bytes, bool, type(None)) or (type(body) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in body)) else body.__name__ if type(body) is type else type(body).__name__) + ", " + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + '] =>', record(ns['f'], *args))
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: record(ns['f'], *args)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for sname, src in (('case if', SRC), ('case', SRC2), ('loop', SRC3), ...")
