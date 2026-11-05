# `break` and `continue` through a `finally` clause that never comes to its end (it returns, raises, or loops for ever) do not get where they
# were going. If nothing else gets there either, what stands there cannot be reached, and the code has no such lines.
import warnings
warnings.simplefilter('ignore')

SHAPES = {
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


class Manager:
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def __call__(self): raise KeyError
    def __bool__(self): return True
    def __iter__(self): return iter((1, 2))
    def __iadd__(self, other): return self


for name, source in SHAPES.items():
    namespace = {}
    exec(compile(source, '<shape>', 'exec'), namespace)
    code = namespace['f'].__code__
    print(name, sorted({line for _, _, line in code.co_lines() if line}))
    if 'loops' in name:
        continue
    for argument in (Manager(), 0, 1, (), (1, 2)):
        try:
            print('   ', type(argument).__name__, argument if not isinstance(argument, Manager) else '', namespace['f'](argument))
        except Exception as e:
            print('   ', type(argument).__name__, type(e).__name__)
