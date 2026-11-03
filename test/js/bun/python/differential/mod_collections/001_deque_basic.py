from _collections import deque

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

d = deque()
print(d, len(d), bool(d), d.maxlen)
d.append(1); d.append(2); d.appendleft(0)
print(d, len(d), list(d), d[0], d[-1], d[1])
print(d.pop(), d.popleft(), d)
print(d.pop(), d)
t(lambda: d.pop())
t(lambda: d.popleft())
d.extend(range(5)); print(d)
d.extendleft("abc"); print(d)
d.extend(d); print(d, len(d))
d.clear(); print(d, len(d))
d = deque(range(10))
for n in (0, 1, -1, 3, -3, 10, 11, -11, 25, -25, 1000003):
    d.rotate(n)
    print(n, list(d))
d.rotate(); print(list(d))
d = deque("abcdef")
d.reverse(); print(d)
print(d.count("a"), d.count("z"), "a" in d, "z" in d)
print(d.index("c"), d.index("c", 1), d.index("c", -4), d.index("c", 0, 100))
t(lambda: d.index("c", 4))
t(lambda: d.index("c", 0, 2))
t(lambda: d.index("zz"))
t(lambda: d.index("c", "x"))
t(lambda: d.index("c", None))
d.remove("c"); print(d)
t(lambda: d.remove("c"))
d.insert(0, "X"); print(d)
d.insert(100, "Y"); print(d)
d.insert(-100, "Z"); print(d)
d.insert(2, "M"); print(d)
d.insert(-2, "N"); print(d)
d[0] = 1; d[-1] = 2; d[3] = 3; print(d)
del d[0]; print(d)
del d[-1]; print(d)
del d[2]; print(d)
t(lambda: d[100]); t(lambda: d[-100])
t(lambda: d.__setitem__(100, 1)); t(lambda: d.__delitem__(100))
t(lambda: d["a"]); t(lambda: d[1:2]); t(lambda: d[1.0])
def set_a(): d["a"] = 1
def del_s(): del d[:1]
def set_s(): d[0:1] = [1]
t(set_a); t(del_s); t(set_s)
c = d.copy(); c.append(99); print(d, c)
import sys
c = d.__copy__(); print(c == d, c is d)
print(list(reversed(d)), list(iter(d)))
print(deque([1, 2]) + deque([3]), deque([1, 2]) * 2, 2 * deque([1, 2]), deque([1]) * 0, deque([1]) * -1, deque() * 5, deque([7]) * 4)
t(lambda: deque([1]) + [2])
tn(lambda: [2] + deque([1]))
t(lambda: deque([1]) * "a")
t(lambda: deque([1]) * 1.5)
t(lambda: deque([1, 2, 3]) * 2 ** 62)
t(lambda: deque([1, 2, 3]) * 2 ** 64)
e = deque([1]); f = e
e += [2, 3]; print(e, e is f)
e *= 2; print(e, e is f)
e *= 1; print(e)
e *= 0; print(e, e is f)
def bad():
    x = deque([1]); x += 5
t(bad)
def bad2():
    x = deque([1]); x *= "a"
t(bad2)
tn(lambda: hash(deque()) and None)
print(deque.__hash__)
