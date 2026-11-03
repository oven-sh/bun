class P:
    def __init__(self, x): self.x = x
    def __repr__(self): return f"P({self.x})"
class Plain: pass
def add(a, b): return a + b
d = {"a": 1, "b": [1, 2.0], 3: (4,)}
t = (1, "two", None, 3.0)
s = {1}
floats = [1.0, 2.5]
b = b"bytes"
def fail(): raise ValueError("shown")
class MyErr(Exception): pass
def fail2():
    try:
        fail()
    except ValueError as e:
        raise MyErr("outer") from e
