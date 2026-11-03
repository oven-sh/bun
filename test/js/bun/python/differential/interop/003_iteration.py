log = []
def gen(n):
    try:
        for i in range(n):
            got = yield i
            if got is not None:
                log.append(("got", got))
    finally:
        log.append("closed")
    return "done"
def floats():
    yield 1.0
    yield 2.5
class Countdown:
    def __init__(self, n): self.n = n
    def __iter__(self): return self
    def __next__(self):
        if self.n <= 0: raise StopIteration
        self.n -= 1
        return self.n + 1
class OwnNext:
    "An iterator with an attribute called next of its own."
    def __init__(self): self.items = [1, 2]; self.next = "mine"
    def __iter__(self): return self
    def __next__(self):
        if not self.items: raise StopIteration
        return self.items.pop(0)
class OldStyle:
    def __getitem__(self, i):
        if i >= 3: raise IndexError
        return i * 10
class NotIterable: pass
class Blocked:
    __iter__ = None
    def __getitem__(self, i): raise IndexError
class Failing:
    def __iter__(self): raise ValueError("no iter")
class Closable:
    def __init__(self): self.closed = False
    def __iter__(self): return self
    def __next__(self): return 1
    def close(self): self.closed = True
d = {"a": 1, "b": 2}
t = (1, 2, 3)
s = "héllo😀"
def total(it): return sum(it)
def as_list(it): return list(it)
def catcher():
    try:
        yield 1
    except ValueError as e:
        yield "caught " + str(e)
    except Exception as e:
        yield "js " + type(e).__name__
