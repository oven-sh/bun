try:
    class C:
        if True:
            x: int
        else:
            y: str
        z: float
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C:')
try: print(C.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.__annotations__')
try:
    def f():
        class D:
            if 1:
                a: int
            def m(self): return __class__
        return D
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f():')
try: print(f().__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f().__annotations__')
try:
    class E:
        __conditional_annotations__ = {1}
        if True:
            q: int
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E:')
try: print('E.__annotations__ =>', E.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E.__annotations__')
try: print('E.__conditional_annotations__ =>', E.__conditional_annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E.__conditional_annotations__')
try:
    if True:
        try: g: int
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g: int')
    else:
        try: h: int
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h: int')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if True:')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: print(sys.modules[__name__].__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.modules[__name__].__annotations__')
try:
    class F:
        a: int
        for _ in range(2):
            b: str
        while False:
            c: bytes
        try:
            d: float
        except Exception:
            e: complex
        with open(__file__) as _f:
            f: list
        match 1:
            case 1:
                g: dict
            case _:
                h: set
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class F:')
try: print('F.__annotations__ =>', F.__annotations__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: F.__annotations__')
try: print('F.__annotate_func__.__code__.co_freevars =>', F.__annotate_func__.__code__.co_freevars)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: F.__annotate_func__.__code__.co_freevars')
try: import dataclasses, typing
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import dataclasses, typing')
try:
    @dataclasses.dataclass
    class G:
        x: int = 1
        if sys.version_info >= (3, 0):
            y: str = "new"
        else:
            z: str = "old"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class G:')
try: print('G() =>', G())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: G()')
try: print('typing.get_type_hints(G) =>', typing.get_type_hints(G))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: typing.get_type_hints(G)')
