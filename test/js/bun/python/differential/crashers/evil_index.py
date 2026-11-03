# Arguments whose __index__ changes the sequence that the call is about. Nothing may crash; what comes out is compared with CPython.
import array, collections, struct, sys

def show(f):
    try:
        r = f()
        if isinstance(r, (bytes, bytearray, list, tuple, str, array.array, collections.deque)) and len(r) > 40:
            return "%s of %d" % (type(r).__name__, len(r))
        return repr(r)
    except BaseException as e:
        return type(e).__name__ + ": " + str(e)[:90]

MAKERS = {
    "list": lambda: list(range(20)),
    "bytearray": lambda: bytearray(range(20)),
    "array": lambda: array.array("i", range(20)),
    "deque": lambda: collections.deque(range(20)),
}
def clear(x): x.clear() if hasattr(x, "clear") else x.__delitem__(slice(None))
def grow(x): x.extend(range(100)); x.extend(range(100)); x.extend(range(100))
def shrink(x):
    while len(x) > 1: x.pop()
def grow_much(x):
    for _ in range(40): x.extend(range(250))
ACTIONS = {"clear": clear, "grow": grow, "shrink": shrink, "grow_much": grow_much}

class Evil:
    def __init__(self, target, action, value):
        self.target, self.action, self.value, self.done = target, action, value, False
    def __repr__(self): return "Evil"
    def __index__(self):
        if not self.done:
            self.done = True
            self.action(self.target)
        return self.value

OPS = [
    ("x[e]", lambda x, e: x[e]),
    ("x[e] = 1", lambda x, e: x.__setitem__(e, 1)),
    ("del x[e]", lambda x, e: x.__delitem__(e)),
    ("x[e:]", lambda x, e: x[e:]),
    ("x[:e]", lambda x, e: x[:e]),
    ("x[::e]", lambda x, e: x[::e]),
    ("x[e:15:2]", lambda x, e: x[e:15:2]),
    ("x[e:] = x5", lambda x, e: x.__setitem__(slice(e, None), type(x)(x)[:5] if not isinstance(x, collections.deque) else [1])),
    ("x[:e] = x5", lambda x, e: x.__setitem__(slice(None, e), type(x)(x)[:5] if not isinstance(x, collections.deque) else [1])),
    ("x[2:e:2] = ...", lambda x, e: x.__setitem__(slice(2, e, 2), type(x)(x)[:3] if not isinstance(x, collections.deque) else [1])),
    ("x[::e] = ...", lambda x, e: x.__setitem__(slice(None, None, e), type(x)(x)[:4] if not isinstance(x, collections.deque) else [1])),
    ("del x[e:]", lambda x, e: x.__delitem__(slice(e, None))),
    ("del x[:e]", lambda x, e: x.__delitem__(slice(None, e))),
    ("del x[::e]", lambda x, e: x.__delitem__(slice(None, None, e))),
    ("del x[e:18:3]", lambda x, e: x.__delitem__(slice(e, 18, 3))),
    ("x * e", lambda x, e: x * e),
    ("e * x", lambda x, e: e * x),
    ("x *= e", lambda x, e: x.__imul__(e)),
    ("x.insert(e, 1)", lambda x, e: x.insert(e, 1)),
    ("x.insert(1, e)", lambda x, e: x.insert(1, e)),
    ("x.append(e)", lambda x, e: x.append(e)),
    ("x.pop(e)", lambda x, e: x.pop(e)),
    ("x.index(3, e)", lambda x, e: x.index(3, e)),
    ("x.index(3, 0, e)", lambda x, e: x.index(3, 0, e)),
    ("x.index(e)", lambda x, e: x.index(e)),
    ("x.count(e)", lambda x, e: x.count(e)),
    ("x.remove(e)", lambda x, e: x.remove(e)),
    ("e in x", lambda x, e: e in x),
    ("x.rotate(e)", lambda x, e: x.rotate(e)),
    ("x.extend([e, e])", lambda x, e: x.extend([e, 1, 2])),
    ("x += [e]", lambda x, e: x.__iadd__(type(x)([1]) if isinstance(x, array.array) else [e, 1])),
    ("x.find(b, e)", lambda x, e: x.find(b"\x03", e)),
    ("x.find(e)", lambda x, e: x.find(e)),
    ("x.rfind(b, 0, e)", lambda x, e: x.rfind(b"\x03", 0, e)),
    ("x.count(b, e)", lambda x, e: x.count(b"\x03", e)),
    ("x.startswith(b, e)", lambda x, e: x.startswith(b"\x03", e)),
    ("x.endswith(b, 0, e)", lambda x, e: x.endswith(b"\x03", 0, e)),
    ("x.center(e)", lambda x, e: x.center(e)),
    ("x.ljust(e)", lambda x, e: x.ljust(e)),
    ("x.rjust(e, b)", lambda x, e: x.rjust(e, b"-")),
    ("x.zfill(e)", lambda x, e: x.zfill(e)),
    ("x.expandtabs(e)", lambda x, e: x.expandtabs(e)),
    ("x.split(b, e)", lambda x, e: x.split(b"\x03", e)),
    ("x.rsplit(None, e)", lambda x, e: x.rsplit(None, e)),
    ("x.replace(a, b, e)", lambda x, e: x.replace(b"\x03", b"xx", e)),
    ("x.hex(sep, e)", lambda x, e: x.hex(":", e)),
    ("x.resize(e)", lambda x, e: x.resize(e)),
    ("x.take_bytes(e)", lambda x, e: x.take_bytes(e)),
    ("pack_into(x, e)", lambda x, e: struct.pack_into("<i", x, e, 7)),
    ("pack_into(x, 0, e)", lambda x, e: struct.pack_into("<i", x, 0, e)),
    ("unpack_from(x, e)", lambda x, e: struct.unpack_from("<i", x, e)),
    ("memoryview(x)[e]", lambda x, e: memoryview(x)[e]),
    ("memoryview(x)[e:]", lambda x, e: bytes(memoryview(x)[e:])),
    ("memoryview(x)[e] = 1", lambda x, e: memoryview(x).__setitem__(e, 1)),
    ("memoryview(x)[1] = e", lambda x, e: memoryview(x).__setitem__(1, e)),
    ("int.from_bytes", lambda x, e: int.from_bytes(x[:4], "little")),
    ("bytes(x)[e]", lambda x, e: bytes(x)[e]),
    ("x.fromlist([e])", lambda x, e: x.fromlist([e, 1])),
    ("x.byteswap", lambda x, e: x.byteswap()),
    ("range(e)[x0]", lambda x, e: range(e)[x[0]]),
    ("x.__reduce_ex__(e)", lambda x, e: len(x.__reduce_ex__(e))),
    ("deque(x, e)", lambda x, e: collections.deque(x, e)),
]
GROUP = sys.argv[1] if len(sys.argv) > 1 else None
for kind, make in MAKERS.items():
    for action_name, action in ACTIONS.items():
        if GROUP == "--list":
            print(kind, action_name)
            continue
        if GROUP is not None and GROUP != kind + " " + action_name:
            continue
        for value in (0, 1, 5, 19, 25, -1, -5, -30, 2):
            for name, op in OPS:
                x = make()
                r = show(lambda: op(x, Evil(x, action, value)))
                if r.startswith("AttributeError"): continue
                print(kind, action_name, value, name, "->", r, "|", len(x), show(lambda: list(x)[:6]))
