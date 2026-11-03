# Globals and builtins that are not plain dicts.
try: import types, sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import types, sys')
try:
    def t(f, *a, **k):
        try:
            return f(*a, **k)
        except BaseException as e:
            return type(e).__name__ + ": " + str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f, *a, **k):')

try: print("--- globals that are a dict subclass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- globals that are a dict subclass"')
try:
    class Missing(dict):
        def __missing__(self, key): return "missing " + key
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Missing(dict):')
try:
    def f(): return undefined_name, len
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f(): return undefined_name, len')
try: g = types.FunctionType(f.__code__, Missing())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = types.FunctionType(f.__code__, Missing())')
try: print(g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g()')
try: g = types.FunctionType(f.__code__, Missing(len=3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = types.FunctionType(f.__code__, Missing(len=3))')
try: print(g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g()')
try:
    class Get(dict):
        def __getitem__(self, key): return ("got", key)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Get(dict):')
try: print(types.FunctionType(f.__code__, Get())())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: types.FunctionType(f.__code__, Get())()')
try:
    class Err(Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Err(Exception): pass')
try:
    class Raises(dict):
        def __getitem__(self, key): raise Err(key)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Raises(dict):')
try: print(t(types.FunctionType(f.__code__, Raises(undefined_name=1))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(types.FunctionType(f.__code__, Raises(undefined_name=1)))')
try: print(t(exec, compile("globalname", "test", "exec"), Raises({'globalname': 1})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(exec, compile("globalname", "test", "exec"), Raises({\'globalname\': ...')
try: print(t(exec, compile("superglobal", "test", "exec"), {'__builtins__': Raises({'superglobal': 1})}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(exec, compile("superglobal", "test", "exec"), {\'__builtins__\': Rais...')
try: print(t(eval, "x + y", Missing(x="a ")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(eval, "x + y", Missing(x="a "))')
try: print(t(eval, "(lambda: x + y)()", Missing(x="a ")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(eval, "(lambda: x + y)()", Missing(x="a "))')
try: print(t(eval, "[x + y for _ in range(1)]", Missing(x="a ")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(eval, "[x + y for _ in range(1)]", Missing(x="a "))')
try: calls = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls = []')
try:
    class Counts(dict):
        def __getitem__(self, key):
            calls.append(key); return dict.__getitem__(self, key)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Counts(dict):')
try: print('t(eval, "len(x)", Counts(x="abc")) =>', t(eval, "len(x)", Counts(x="abc")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(eval, "len(x)", Counts(x="abc"))')
try: print('calls =>', calls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls')
try: calls.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls.clear()')
try: print('t(eval, "(lambda: len(x))()", Counts(x="abc")) =>', t(eval, "(lambda: len(x))()", Counts(x="abc")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(eval, "(lambda: len(x))()", Counts(x="abc"))')
try: print('calls =>', calls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calls')
try: print("--- builtins that are mappings")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- builtins that are mappings"')
try: print(t(eval, "superglobal", {'__builtins__': types.MappingProxyType({'superglobal': 1})}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(eval, "superglobal", {\'__builtins__\': types.MappingProxyType({\'supe...')
try: print(t(eval, "superglobal", {'__builtins__': types.MappingProxyType({})}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(eval, "superglobal", {\'__builtins__\': types.MappingProxyType({})})')
try: print(t(eval, "(lambda: superglobal)()", {'__builtins__': types.MappingProxyType({'superglobal': 1})}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(eval, "(lambda: superglobal)()", {\'__builtins__\': types.MappingProx...')
try: print(t(eval, "x.__reduce__()", {'__builtins__': types.MappingProxyType({}), 'x': iter([1, 2])}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(eval, "x.__reduce__()", {\'__builtins__\': types.MappingProxyType({})...')
try: print(t(eval, "x.__reduce__()", {'__builtins__': types.MappingProxyType({'iter': iter}), 'x': iter([1, 2])}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(eval, "x.__reduce__()", {\'__builtins__\': types.MappingProxyType({\'i...')
try: ns = {'__builtins__': types.MappingProxyType({'__import__': lambda *args: args})}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ns = {'__builtins__': types.MappingProxyType({'__import__': lambda *a...")
try: print('t(exec, "import foo.bar", ns) =>', t(exec, "import foo.bar", ns))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(exec, "import foo.bar", ns)')
try: print("ns.get('foo')[0] =>", ns.get('foo')[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ns.get('foo')[0]")
try: print("ns.get('foo')[1] is ns =>", ns.get('foo')[1] is ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ns.get('foo')[1] is ns")
try: print("ns.get('foo')[3:] =>", ns.get('foo')[3:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ns.get('foo')[3:]")
try: print(t(exec, "import foo.bar", {'__builtins__': types.MappingProxyType({})}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(exec, "import foo.bar", {\'__builtins__\': types.MappingProxyType({})})')
try: print(t(exec, "class C: pass", {'__builtins__': types.MappingProxyType({})}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(exec, "class C: pass", {\'__builtins__\': types.MappingProxyType({})})')
try: print(t(exec, "class C: pass\nr = C", {'__builtins__': types.MappingProxyType({'__build_class__': lambda *a: "built"})}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(exec, "class C: pass\\nr = C", {\'__builtins__\': types.MappingProxyTy...')
try: print("--- a function inherits the builtins of whoever makes it")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- a function inherits the builtins of whoever makes it"')
try:
    def func(s): return len(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def func(s): return len(s)')
try: ns = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns = {}')
try: func2 = type(func)(func.__code__, ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: func2 = type(func)(func.__code__, ns)')
try: print('func2.__globals__ is ns =>', func2.__globals__ is ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: func2.__globals__ is ns')
try: print('func2.__builtins__ is func.__builtins__ =>', func2.__builtins__ is func.__builtins__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: func2.__builtins__ is func.__builtins__')
try: print('func2("abc") =>', func2("abc"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: func2("abc")')
try: print('ns =>', ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns')
try: safe = {'None': None}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: safe = {'None': None}")
try: ns = {'type': type, '__builtins__': safe}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ns = {'type': type, '__builtins__': safe}")
try: exec("def func3(s): pass\nfunc4 = type(func3)(func3.__code__, {})", ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exec("def func3(s): pass\\nfunc4 = type(func3)(func3.__code__, {})", ns)')
try: print("ns['func3'].__builtins__ is safe =>", ns['func3'].__builtins__ is safe)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ns['func3'].__builtins__ is safe")
try: print("ns['func4'].__builtins__ is safe =>", ns['func4'].__builtins__ is safe)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ns['func4'].__builtins__ is safe")
try: print("ns['func4'].__globals__ =>", ns['func4'].__globals__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ns['func4'].__globals__")
try: print("--- frozendict")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- frozendict"')
try:
    try:
        print('t(eval, "a + b", frozendict(a=1, b=2)) =>', t(eval, "a + b", frozendict(a=1, b=2)))
        print('t(exec, "a = 1", frozendict()) =>', t(exec, "a = 1", frozendict()))
        print('t(exec, "global a\\na = 1", frozendict()) =>', t(exec, "global a\na = 1", frozendict()))
        print('t(exec, "del a", frozendict(a=1)) =>', t(exec, "del a", frozendict(a=1)))
    except NameError as e: print(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: print(t(eval, "a", {}, frozendict(a=1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(eval, "a", {}, frozendict(a=1))')
try: print(t(exec, "a = 2", {}, frozendict(a=1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(exec, "a = 2", {}, frozendict(a=1))')
