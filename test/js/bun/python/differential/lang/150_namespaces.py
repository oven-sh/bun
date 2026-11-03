# Globals and builtins that are not plain dicts.
import types, sys
def t(f, *a, **k):
    try:
        return f(*a, **k)
    except BaseException as e:
        return type(e).__name__ + ": " + str(e)

print("--- globals that are a dict subclass")
class Missing(dict):
    def __missing__(self, key): return "missing " + key
def f(): return undefined_name, len
g = types.FunctionType(f.__code__, Missing())
print(g())
g = types.FunctionType(f.__code__, Missing(len=3))
print(g())
class Get(dict):
    def __getitem__(self, key): return ("got", key)
print(types.FunctionType(f.__code__, Get())())
class Err(Exception): pass
class Raises(dict):
    def __getitem__(self, key): raise Err(key)
print(t(types.FunctionType(f.__code__, Raises(undefined_name=1))))
print(t(exec, compile("globalname", "test", "exec"), Raises({'globalname': 1})))
print(t(exec, compile("superglobal", "test", "exec"), {'__builtins__': Raises({'superglobal': 1})}))
print(t(eval, "x + y", Missing(x="a ")))
print(t(eval, "(lambda: x + y)()", Missing(x="a ")))
print(t(eval, "[x + y for _ in range(1)]", Missing(x="a ")))
calls = []
class Counts(dict):
    def __getitem__(self, key):
        calls.append(key); return dict.__getitem__(self, key)
print(t(eval, "len(x)", Counts(x="abc")), calls)
calls.clear()
print(t(eval, "(lambda: len(x))()", Counts(x="abc")), calls)
print("--- builtins that are mappings")
print(t(eval, "superglobal", {'__builtins__': types.MappingProxyType({'superglobal': 1})}))
print(t(eval, "superglobal", {'__builtins__': types.MappingProxyType({})}))
print(t(eval, "(lambda: superglobal)()", {'__builtins__': types.MappingProxyType({'superglobal': 1})}))
print(t(eval, "x.__reduce__()", {'__builtins__': types.MappingProxyType({}), 'x': iter([1, 2])}))
print(t(eval, "x.__reduce__()", {'__builtins__': types.MappingProxyType({'iter': iter}), 'x': iter([1, 2])}))
ns = {'__builtins__': types.MappingProxyType({'__import__': lambda *args: args})}
print(t(exec, "import foo.bar", ns), ns.get('foo')[0], ns.get('foo')[1] is ns, ns.get('foo')[3:])
print(t(exec, "import foo.bar", {'__builtins__': types.MappingProxyType({})}))
print(t(exec, "class C: pass", {'__builtins__': types.MappingProxyType({})}))
print(t(exec, "class C: pass\nr = C", {'__builtins__': types.MappingProxyType({'__build_class__': lambda *a: "built"})}))
print("--- a function inherits the builtins of whoever makes it")
def func(s): return len(s)
ns = {}
func2 = type(func)(func.__code__, ns)
print(func2.__globals__ is ns, func2.__builtins__ is func.__builtins__, func2("abc"), ns)
safe = {'None': None}
ns = {'type': type, '__builtins__': safe}
exec("def func3(s): pass\nfunc4 = type(func3)(func3.__code__, {})", ns)
print(ns['func3'].__builtins__ is safe, ns['func4'].__builtins__ is safe, ns['func4'].__globals__)
print("--- frozendict")
try:
    print(t(eval, "a + b", frozendict(a=1, b=2)), t(exec, "a = 1", frozendict()), t(exec, "global a\na = 1", frozendict()), t(exec, "del a", frozendict(a=1)))
except NameError as e: print(e)
print(t(eval, "a", {}, frozendict(a=1)))
print(t(exec, "a = 2", {}, frozendict(a=1)))
