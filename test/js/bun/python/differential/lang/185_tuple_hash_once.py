# A tuple works its hash out once.
class Key:
    calls = 0
    def __init__(self, value): self.value = value
    def __hash__(self):
        Key.calls += 1
        return hash(self.value)
    def __eq__(self, other): return self.value == other.value

def calls(f):
    Key.calls = 0
    f()
    return Key.calls

t = (Key(1), Key(2), "x", 3)
print(calls(lambda: hash(t)), calls(lambda: hash(t)), calls(lambda: {t: 1}[t]), calls(lambda: t in {t}), hash(t) == hash((1, 2, "x", 3)))
nested = (t, (t, t), Key(5))
print(calls(lambda: hash(nested)), calls(lambda: hash(nested)), calls(lambda: hash((t, Key(6)))))

# The values are what they always were.
print(hash(()), hash((1,)), hash((1, 2)), hash((1, 2, 3)), hash(((), ())), hash((1.5, None, True)), hash((-1,)), hash((2**70,)))
print(hash((1, 2)) == hash((1.0, 2.0)) == hash((True, 2)), hash((1, 2)) != hash((2, 1)))

# What cannot be hashed is asked again each time, and nothing is remembered of the attempt.
class Moody:
    ok = False
    def __hash__(self):
        if not Moody.ok:
            raise TypeError("not now")
        return 7
m = (1, Moody())
for _ in range(2):
    try:
        hash(m)
    except TypeError as e:
        print("TypeError", e)
Moody.ok = True
print(hash(m) == hash((1, 7)), hash(m) == hash(m))
for bad in ((1, []), ([],), (1, (2, {}))):
    for _ in range(2):
        try:
            hash(bad)
        except TypeError as e:
            print("TypeError", e)

# Classes derived from tuple.
import collections
P = collections.namedtuple("P", "x y")
p = P(Key(1), Key(2))
print(calls(lambda: hash(p)), calls(lambda: hash(p)), hash(p) == hash((1, 2)))
class T(tuple): pass
s = T((Key(1), Key(2)))
print(calls(lambda: hash(s)), calls(lambda: hash(s)), hash(s) == hash((1, 2)))
class Own(tuple):
    def __hash__(self): return 42
o = Own((Key(1),))
print(calls(lambda: hash(o)), hash(o), calls(lambda: tuple.__hash__(o)), calls(lambda: tuple.__hash__(o)), tuple.__hash__(o) == hash((1,)))

# Large ones, often.
big = tuple(range(200000))
h = hash(big)
print(all(hash(big) == h for _ in range(20000)), len({big: 1, tuple(range(200000)): 2}))
import copy, pickle
print(hash(copy.deepcopy(big[:50])) == hash(big[:50]) == hash(pickle.loads(pickle.dumps(big[:50]))))
