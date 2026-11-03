def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

x = 1
def read_global():
    return x
print(read_global())
def shadow():
    x = 2
    return x
print(shadow(), x)
def write_global():
    global x
    x = 3
write_global()
print(x)
def create_global():
    global brand_new
    brand_new = "new"
create_global()
print(brand_new)
def unbound():
    print(x)
    x = 1
t(unbound)
def unbound2():
    if False:
        y = 1
    return y
t(unbound2)
def unbound3():
    del_me = 1
    del del_me
    return del_me
t(unbound3)
def unbound_aug():
    x += 1
t(unbound_aug)
t(lambda: not_defined)
def nameerr():
    return also_not_defined
t(nameerr)
def del_unbound():
    del zzz
t(del_unbound)
def del_global():
    global gone
    del gone
t(del_global)
def for_unbound():
    for i in []:
        pass
    return i
t(for_unbound)
def except_unbound():
    try:
        raise ValueError("v")
    except ValueError as e:
        pass
    return e
t(except_unbound)
# Closures.
def outer():
    a = 1
    def inner():
        return a
    a = 2
    return inner
print(outer()())
def counter():
    n = 0
    def inc():
        nonlocal n
        n += 1
        return n
    return inc
c1 = counter(); c2 = counter()
print(c1(), c1(), c2(), c1())
def free_unbound():
    def inner():
        return later
    try:
        print(inner())
    except NameError as e:
        print(type(e).__name__, e)
    later = 5
    return inner()
print(free_unbound())
def del_free():
    v = 1
    def inner():
        return v
    del v
    return inner()
t(del_free)
def three_levels():
    a = "a"
    def mid():
        b = "b"
        def low():
            return a + b
        return low
    return mid()()
print(three_levels())
def nonlocal_through():
    v = 0
    def mid():
        def low():
            nonlocal v
            v += 10
        low(); low()
    mid()
    return v
print(nonlocal_through())
# Each call makes new cells; a loop does not.
fs = []
for i in range(3):
    fs.append(lambda: i)
print([f() for f in fs])
fs = [lambda i=i: i for i in range(3)]
print([f() for f in fs])
def make(i):
    return lambda: i
print([f() for f in [make(i) for i in range(3)]])
def loop_closure():
    r = []
    for j in range(3):
        r.append(lambda: j)
    return [f() for f in r]
print(loop_closure())
# Class scopes are not enclosing scopes for functions.
y = "global y"
class K:
    y = "class y"
    def m(self):
        return y
    z = y + "!"
    l = [y for _ in range(1)]
print(K().m(), K.z, K.l)
def func_with_class():
    y = "func y"
    class K2:
        w = y
        def m(self):
            return y
    return K2.w, K2().m()
print(func_with_class())
def class_local_then_enclosing():
    v = "enclosing"
    class K3:
        a = v
        v = "class"
        b = v
    return K3.a, K3.b
t(class_local_then_enclosing)
v = "module v"
def class_sees_global():
    v = "enclosing"
    class K4:
        print(v)
        v = "class"
    return K4.v
t(class_sees_global)
# globals() and locals()
gl = globals()
print(gl["x"], "x" in gl, gl is globals(), __name__)
gl["via_dict"] = 99
print(via_dict)
def loc(a, b=2):
    c = 3
    return sorted(locals().items())
print(loc(1))
def loc2():
    l = locals()
    q = 1
    return l, sorted(locals())
print(loc2())
print(locals() is globals())
# builtins can be shadowed, and come back.
len = lambda x: "shadowed"
print(len([1]))
del len
print(len([1]))
def shadow_builtin():
    max = 5
    return max
print(shadow_builtin(), max(1, 2))
a = b = c = []
a.append(1)
print(b, c, a is c)
i = j = 0
i += 1
print(i, j)
del a
t(lambda: a)
print(b)
x = 1; del x
t(lambda: x)
te = "global te"
def param_global_conflict():
    try:
        exec("def f(a):\n    global a\n")
    except SyntaxError as e:
        print("SyntaxError", e.msg)
    try:
        exec("def f():\n    a = 1\n    global a\n")
    except SyntaxError as e:
        print("SyntaxError", e.msg)
    try:
        exec("def f():\n    nonlocal q\n")
    except SyntaxError as e:
        print("SyntaxError", e.msg)
    try:
        exec("nonlocal q\n")
    except SyntaxError as e:
        print("SyntaxError", e.msg)
    try:
        exec("def f():\n    print(a)\n    global a\n")
    except SyntaxError as e:
        print("SyntaxError", e.msg)
    try:
        exec("def f():\n    a = 1\n    def g():\n        global a\n        nonlocal a\n")
    except SyntaxError as e:
        print("SyntaxError", e.msg)
param_global_conflict()
