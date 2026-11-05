# `break` and `continue` through a `finally` clause that never comes to its end (it returns, raises, or loops for ever) do not get where they
# were going. If nothing else gets there either, what stands there cannot be reached, and the code has no such lines.
try: import warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import warnings')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")

try: SHAPES = {
'break, while True': '''
def f(a):
    while True:
        try:
            break
        finally:
            return 1
    z = 1
    return z
''',
'continue, while True': '''
def f(a):
    while True:
        try:
            continue
        finally:
            return 1
    z = 1
    return z
''',
'break, while a': '''
def f(a):
    while a:
        try:
            break
        finally:
            return 1
    z = 1
    return z
''',
'break, for': '''
def f(a):
    for x in a:
        try:
            break
        finally:
            return 1
    else:
        z = 2
    z = 1
    return z
''',
'break, finally raises': '''
def f(a):
    while True:
        try:
            break
        finally:
            raise KeyError
    z = 1
    return z
''',
'break, finally loops': '''
def f(a):
    while True:
        try:
            break
        finally:
            while True:
                a += 1
    z = 1
    return z
''',
'break in if': '''
def f(a):
    while True:
        try:
            if a:
                break
            a += 1
        finally:
            return 1
    z = 1
    return z
''',
'break, two finally': '''
def f(a):
    while True:
        try:
            try:
                break
            finally:
                a += 1
        finally:
            return 1
    z = 1
    return z
''',
'break, with around': '''
def f(a):
    while True:
        with a:
            try:
                break
            finally:
                return 1
    z = 1
    return z
''',
'continue, last in body': '''
def f(a):
    while a:
        try:
            continue
        finally:
            return 1
        a += 1
    z = 1
    return z
''',
'break last of function': '''
def f(a):
    while True:
        try:
            break
        finally:
            return 1
''',
'break in except': '''
def f(a):
    while True:
        try:
            a()
        except KeyError:
            try:
                break
            finally:
                return 2
        a += 1
    z = 1
    return z
''',
'return in finally of return': '''
def f(a):
    try:
        return 1
    finally:
        return 2
    z = 1
''',
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: SHAPES = { 'break, while True': ''' def f(a): while True: try: break ...")


try:
    class Manager:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def __call__(self): raise KeyError
        def __bool__(self): return True
        def __iter__(self): return iter((1, 2))
        def __iadd__(self, other): return self
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Manager:')


try:
    for name, source in SHAPES.items():
        try: namespace = {}
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: namespace = {}')
        try: exec(compile(source, '<shape>', 'exec'), namespace)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec(compile(source, '<shape>', 'exec'), namespace)")
        try: code = namespace['f'].__code__
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: code = namespace['f'].__code__")
        try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
        try: print('sorted({line for _, _, line in code.co_lines() if line}) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', sorted({line for _, _, line in code.co_lines() if line}))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted({line for _, _, line in code.co_lines() if line})')
        if 'loops' in name:
            continue
        for argument in (Manager(), 0, 1, (), (1, 2)):
            try:
                print('   ', 'type(argument).__name__ [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'argument=' + (repr(argument) if type(argument) in (str, int, float, bytes, bool, type(None)) or (type(argument) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in argument)) else argument.__name__ if type(argument) is type else type(argument).__name__) + '] =>', type(argument).__name__)
                print("argument if not isinstance(argument, Manager) else '' [" + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'argument=' + (repr(argument) if type(argument) in (str, int, float, bytes, bool, type(None)) or (type(argument) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in argument)) else argument.__name__ if type(argument) is type else type(argument).__name__) + '] =>', argument if not isinstance(argument, Manager) else '')
                print("namespace['f'](argument) [" + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'argument=' + (repr(argument) if type(argument) in (str, int, float, bytes, bool, type(None)) or (type(argument) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in argument)) else argument.__name__ if type(argument) is type else type(argument).__name__) + '] =>', namespace['f'](argument))
            except Exception as e:
                print('   ', 'type(argument).__name__ [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'argument=' + (repr(argument) if type(argument) in (str, int, float, bytes, bool, type(None)) or (type(argument) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in argument)) else argument.__name__ if type(argument) is type else type(argument).__name__) + '] =>', type(argument).__name__)
                print('type(e).__name__ [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'argument=' + (repr(argument) if type(argument) in (str, int, float, bytes, bool, type(None)) or (type(argument) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in argument)) else argument.__name__ if type(argument) is type else type(argument).__name__) + '] =>', type(e).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name, source in SHAPES.items():')
