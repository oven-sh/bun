class K:
    def __init__(self, f): self.v = f()
    def method(self, f): return f()
    def __call__(self, f): return f()
def call(f): return f()
def call_sorted(f): return sorted([2, 1], key=f)
def call_map(f): return list(map(f, [1]))
def gen(f):
    yield f()
