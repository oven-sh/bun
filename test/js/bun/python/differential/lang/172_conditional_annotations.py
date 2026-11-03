class C:
    if True:
        x: int
    else:
        y: str
    z: float
print(C.__annotations__)
def f():
    class D:
        if 1:
            a: int
        def m(self): return __class__
    return D
print(f().__annotations__)
class E:
    __conditional_annotations__ = {1}
    if True:
        q: int
print(E.__annotations__, E.__conditional_annotations__)
if True:
    g: int
else:
    h: int
import sys
print(sys.modules[__name__].__annotations__)
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
print(F.__annotations__, F.__annotate_func__.__code__.co_freevars)
import dataclasses, typing
@dataclasses.dataclass
class G:
    x: int = 1
    if sys.version_info >= (3, 0):
        y: str = "new"
    else:
        z: str = "old"
print(G(), typing.get_type_hints(G))
