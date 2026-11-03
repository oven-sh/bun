from _collections import deque, _deque_iterator, _deque_reverse_iterator

def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)

def tn(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__)

vals = [deque(), deque([1]), deque([1, 2]), deque([1, 3]), deque([2]), deque([1, 2], 5)]
for a in vals:
    print([(a == b, a != b, a < b, a <= b, a > b, a >= b) for b in vals])
print(deque([1]) == [1], deque([1]) != [1], deque() == (), deque([1]).__eq__([1]), deque([1]).__lt__(1))
tn(lambda: deque([1]) < [1])
t(lambda: deque([1]) < deque(["a"]))
n = float("nan"); print(deque([n]) == deque([n]), n in deque([n]), deque([n]).count(n), deque([n]).index(n))

d = deque(range(5))
it = iter(d); print(type(it).__name__, it.__length_hint__(), next(it), it.__length_hint__(), iter(it) is it)
print(list(it), it.__length_hint__()); t(lambda: next(it))
r = reversed(d); print(type(r).__name__, r.__length_hint__(), next(r), list(r)); t(lambda: next(r))
it = iter(d); next(it); d.append(1); t(lambda: next(it)); t(lambda: next(it)); print(list(it))
it = iter(d); d.rotate(1); t(lambda: next(it))
it = iter(d); d[0] = 100; print(next(it))
it = iter(d); d.reverse(); print(next(it))
it = iter(d); d.clear(); t(lambda: next(it))
d = deque(range(3))
r = reversed(d); d.pop(); t(lambda: next(r)); t(lambda: next(r))
it = iter(deque()); t(lambda: next(it))
d = deque(range(3))
it = iter(d); list(it); d.append(1); t(lambda: next(it))
r = reversed(d); list(r); d.append(1); t(lambda: next(r))

d = deque(range(5))
it = iter(d); next(it); next(it)
red = it.__reduce__(); print(red[0] is _deque_iterator, red[1])
print(list(_deque_iterator(d, 2)), list(_deque_iterator(d)), list(_deque_iterator(d, 100)), list(_deque_iterator(d, -1)))
print(list(_deque_reverse_iterator(d, 2)), list(_deque_reverse_iterator(d)), list(_deque_reverse_iterator(d, 100)))
r = reversed(d); next(r); print(r.__reduce__()[1])
t(lambda: _deque_iterator()); t(lambda: _deque_iterator([1])); t(lambda: _deque_iterator(d, 1, 2)); t(lambda: _deque_iterator(d, "a")); t(lambda: _deque_iterator(None))
t(lambda: _deque_reverse_iterator()); t(lambda: _deque_reverse_iterator([1]))

class Evil:
    def __init__(self, d): self.d = d
    def __eq__(self, other):
        self.d.append(1)
        return False
d = deque([1, 2, 3]); t(lambda: d.count(Evil(d)))
d = deque([1, 2, 3]); t(lambda: Evil(d) in d)
d = deque([1, 2, 3]); t(lambda: d.index(Evil(d)))
d = deque([1, 2, 3]); t(lambda: d.remove(Evil(d)))
class Boom:
    def __eq__(self, other): raise ZeroDivisionError("boom")
d = deque([1, 2, 3])
t(lambda: d.count(Boom())); t(lambda: Boom() in d); t(lambda: d.index(Boom())); t(lambda: d.remove(Boom())); t(lambda: d == deque([Boom(), 2, 3]))
def gen():
    yield 1
    raise KeyError("g")
d = deque(); t(lambda: d.extend(gen())); print(d)
d = deque(); t(lambda: d.extendleft(gen())); print(d)
t(lambda: deque(gen()))
