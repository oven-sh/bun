try:
    def t(f):
        try:
            print(repr(f()))
        except Exception as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try: x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = 1')
try:
    def read_global():
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def read_global():')
try: print(read_global())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read_global()')
try:
    def shadow():
        x = 2
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def shadow():')
try: print('shadow() =>', shadow())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: shadow()')
try: print('x =>', x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try:
    def write_global():
        global x
        x = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def write_global():')
try: write_global()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: write_global()')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try:
    def create_global():
        global brand_new
        brand_new = "new"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def create_global():')
try: create_global()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: create_global()')
try: print(brand_new)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: brand_new')
try:
    def unbound():
        print(x)
        x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def unbound():')
try: print('unbound() =>', end=" "); t(unbound)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(unbound)')
try:
    def unbound2():
        if False:
            y = 1
        return y
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def unbound2():')
try: print('unbound2() =>', end=" "); t(unbound2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(unbound2)')
try:
    def unbound3():
        del_me = 1
        del del_me
        return del_me
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def unbound3():')
try: print('unbound3() =>', end=" "); t(unbound3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(unbound3)')
try:
    def unbound_aug():
        x += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def unbound_aug():')
try: print('unbound_aug() =>', end=" "); t(unbound_aug)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(unbound_aug)')
try: print('not_defined =>', end=" "); t(lambda: not_defined)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: not_defined)')
try:
    def nameerr():
        return also_not_defined
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nameerr():')
try: print('nameerr() =>', end=" "); t(nameerr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(nameerr)')
try:
    def del_unbound():
        del zzz
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def del_unbound():')
try: print('del_unbound() =>', end=" "); t(del_unbound)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(del_unbound)')
try:
    def del_global():
        global gone
        del gone
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def del_global():')
try: print('del_global() =>', end=" "); t(del_global)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(del_global)')
try:
    def for_unbound():
        for i in []:
            pass
        return i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def for_unbound():')
try: print('for_unbound() =>', end=" "); t(for_unbound)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(for_unbound)')
try:
    def except_unbound():
        try:
            raise ValueError("v")
        except ValueError as e:
            pass
        return e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def except_unbound():')
try: print('except_unbound() =>', end=" "); t(except_unbound)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(except_unbound)')
# Closures.
try:
    def outer():
        a = 1
        def inner():
            return a
        a = 2
        return inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer():')
try: print(outer()())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: outer()()')
try:
    def counter():
        n = 0
        def inc():
            nonlocal n
            n += 1
            return n
        return inc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def counter():')
try: c1 = counter()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1 = counter()')
try: c2 = counter()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2 = counter()')
try: print('c1() =>', c1())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1()')
try: print('c1() =>', c1())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1()')
try: print('c2() =>', c2())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2()')
try: print('c1() =>', c1())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1()')
try:
    def free_unbound():
        def inner():
            return later
        try:
            print(inner())
        except NameError as e:
            print(type(e).__name__, e)
        later = 5
        return inner()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def free_unbound():')
try: print(free_unbound())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: free_unbound()')
try:
    def del_free():
        v = 1
        def inner():
            return v
        del v
        return inner()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def del_free():')
try: print('del_free() =>', end=" "); t(del_free)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(del_free)')
try:
    def three_levels():
        a = "a"
        def mid():
            b = "b"
            def low():
                return a + b
            return low
        return mid()()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def three_levels():')
try: print(three_levels())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: three_levels()')
try:
    def nonlocal_through():
        v = 0
        def mid():
            def low():
                nonlocal v
                v += 10
            low(); low()
        mid()
        return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nonlocal_through():')
try: print(nonlocal_through())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nonlocal_through()')
# Each call makes new cells; a loop does not.
try: fs = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fs = []')
try:
    for i in range(3):
        try: fs.append(lambda: i)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fs.append(lambda: i)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(3):')
try: print([f() for f in fs])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [f() for f in fs]')
try: fs = [lambda i=i: i for i in range(3)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fs = [lambda i=i: i for i in range(3)]')
try: print([f() for f in fs])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [f() for f in fs]')
try:
    def make(i):
        return lambda: i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def make(i):')
try: print([f() for f in [make(i) for i in range(3)]])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [f() for f in [make(i) for i in range(3)]]')
try:
    def loop_closure():
        r = []
        for j in range(3):
            r.append(lambda: j)
        return [f() for f in r]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop_closure():')
try: print(loop_closure())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: loop_closure()')
# Class scopes are not enclosing scopes for functions.
try: y = "global y"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: y = "global y"')
try:
    class K:
        y = "class y"
        def m(self):
            return y
        z = y + "!"
        l = [y for _ in range(1)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K:')
try: print('K().m() =>', K().m())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: K().m()')
try: print('K.z =>', K.z)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: K.z')
try: print('K.l =>', K.l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: K.l')
try:
    def func_with_class():
        y = "func y"
        class K2:
            w = y
            def m(self):
                return y
        return K2.w, K2().m()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def func_with_class():')
try: print(func_with_class())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: func_with_class()')
try:
    def class_local_then_enclosing():
        v = "enclosing"
        class K3:
            a = v
            v = "class"
            b = v
        return K3.a, K3.b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def class_local_then_enclosing():')
try: print('class_local_then_enclosing() =>', end=" "); t(class_local_then_enclosing)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(class_local_then_enclosing)')
try: v = "module v"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v = "module v"')
try:
    def class_sees_global():
        v = "enclosing"
        class K4:
            print(v)
            v = "class"
        return K4.v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def class_sees_global():')
try: print('class_sees_global() =>', end=" "); t(class_sees_global)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(class_sees_global)')
# globals() and locals()
try: gl = globals()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gl = globals()')
try: print('gl["x"] =>', gl["x"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gl["x"]')
try: print('"x" in gl =>', "x" in gl)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "x" in gl')
try: print('gl is globals() =>', gl is globals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gl is globals()')
try: print('__name__ =>', __name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: __name__')
try: gl["via_dict"] = 99
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gl["via_dict"] = 99')
try: print(via_dict)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: via_dict')
try:
    def loc(a, b=2):
        c = 3
        return sorted(locals().items())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loc(a, b=2):')
try: print(loc(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: loc(1)')
try:
    def loc2():
        l = locals()
        q = 1
        return l, sorted(locals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loc2():')
try: print(loc2())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: loc2()')
try: print(locals() is globals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: locals() is globals()')
# builtins can be shadowed, and come back.
try: len = lambda x: "shadowed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len = lambda x: "shadowed"')
try: print(len([1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len([1])')
try: del len
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del len')
try: print(len([1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len([1])')
try:
    def shadow_builtin():
        max = 5
        return max
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def shadow_builtin():')
try: print('shadow_builtin() =>', shadow_builtin())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: shadow_builtin()')
try: print('max(1, 2) =>', max(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: max(1, 2)')
try: a = b = c = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = b = c = []')
try: a.append(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.append(1)')
try: print('b =>', b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b')
try: print('c =>', c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c')
try: print('a is c =>', a is c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a is c')
try: i = j = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i = j = 0')
try: i += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i += 1')
try: print('i =>', i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i')
try: print('j =>', j)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: j')
try: del a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del a')
try: print('a =>', end=" "); t(lambda: a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a)')
try: print(b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b')
try: x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = 1')
try: del x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del x')
try: print('x =>', end=" "); t(lambda: x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: x)')
try: te = "global te"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: te = "global te"')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def param_global_conflict():')
try: param_global_conflict()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: param_global_conflict()')
