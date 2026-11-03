__lazy_modules__ = ["plain", "pk.mod"]
import plain
import pk.mod
from plain import a
print("compat:", type(globals()["plain"]).__name__, type(globals()["pk"]).__name__, type(globals()["a"]).__name__)
def f():
    import plain as p2
    return type(p2).__name__
try:
    import plain as p3
    print("in try:", type(globals()["p3"]).__name__)
except ImportError: pass
