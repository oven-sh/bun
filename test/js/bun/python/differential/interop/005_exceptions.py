import js
class AppError(Exception):
    def __init__(self, msg, code):
        super().__init__(msg)
        self.code = code
class WithMessage(Exception):
    def __init__(self): self.message = "own message"
def fail(kind="value"):
    if kind == "value": raise ValueError("bad value")
    if kind == "app": raise AppError("app failed", 7)
    if kind == "key": raise KeyError("k")
    if kind == "zero": return 1 // 0
    if kind == "own": raise WithMessage()
    if kind == "attr": return None.nope
    if kind == "chain":
        try: 1 // 0
        except ZeroDivisionError as e: raise RuntimeError("outer") from e
def call(f, *args): return f(*args)
def call_finally(f, log):
    try:
        return f()
    finally:
        log.append("finally")
def call_with(f, log):
    class CM:
        def __enter__(self): log.append("enter")
        def __exit__(self, *a): log.append("exit " + (a[0].__name__ if a[0] else "None"))
    with CM():
        return f()
def catch(f):
    try:
        f()
    except Exception as e:
        return e
def catch_reraise(f):
    try:
        f()
    except Exception:
        raise
def catch_kind(f):
    try:
        f()
    except ValueError as e: return "ValueError " + str(e)
    except js.python_never if False else () : pass
    except Exception as e: return type(e).__name__ + " " + str(e)
saved = []
def through(f):
    "Python -> JS -> Python: is the exception that comes back the one that was raised?"
    e1 = ValueError("original")
    saved.append(e1)
    def raiser(): raise e1
    try:
        f(raiser)
    except ValueError as e2:
        return e2 is e1
class Hinted:
    def __init__(self):
        self.nope = 1
        self._hidden = 2
    def name(self): return nope
    def attribute(self): return self._hiden
def misspelt():
    value = 1
    return valu
