# Objects that were dropped long ago are finalized when the collector comes, wherever the program is by then: also at the
# recursion limit, where every call fails. Their finalizers and the callbacks of weak references to them must not.
import sys, weakref, gc
effects = []
ignored = []
sys.unraisablehook = lambda args: ignored.append(args.exc_type.__name__)
def note(what, depth=30):
    # A finalizer that needs some frames.
    if depth:
        return note(what, depth - 1)
    effects.append(what)
class WithDel:
    def __init__(self, n): self.n = n
    def __del__(self): note(("del", self.n))
class Plain: pass
references = []
def drop():
    for i in range(40):
        WithDel(i)
        plain = Plain()
        references.append(weakref.ref(plain, lambda r, i=i: note(("callback", i))))
def generator(i):
    try:
        yield
    finally:
        note(("closed", i))
def drop_generators():
    for i in range(10):
        next(generator(i))
drop(); drop_generators()
limits = []
def run():
    # The loop runs in the deepest frame there can be: it is the body of the handler itself.
    def deepest(n):
        try:
            deepest(n + 1)
        except RecursionError:
            if not limits:
                limits.append(sys.getrecursionlimit())
                i = 0
                while i < 2_000_000 and len(effects) < 90:
                    [i]; i += 1
    deepest(0)
run()
print(sorted(effects) == sorted([("del", i) for i in range(40)] + [("callback", i) for i in range(40)] + [("closed", i) for i in range(10)]), len(effects))
print(ignored, limits)
# What a finalizer sees of the limit, and that it has one.
seen = []
class Deep:
    def __del__(self):
        seen.append(sys.getrecursionlimit())
        def forever(n): return forever(n + 1)
        try: forever(0)
        except RecursionError as e: seen.append(str(e))
Deep(); gc.collect()
print(seen)
