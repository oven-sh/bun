# an exception nobody catches
class A:
    def __init__(self, n): self.n = n
    def __del__(self): print("del", self.n)
def f():
    x = A("local")
    raise ValueError("boom")
g = A("global")
f()
