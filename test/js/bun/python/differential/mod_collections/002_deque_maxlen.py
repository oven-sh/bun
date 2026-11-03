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

d = deque(range(10), 3); print(d, d.maxlen, len(d))
d.append(10); print(d)
d.appendleft(0); print(d)
d.extend([1, 2]); print(d)
d.extendleft([7, 8]); print(d)
t(lambda: d.insert(1, 5))
d.pop(); d.insert(1, 5); print(d)
print(d.copy(), d.copy().maxlen, (d + deque([1, 2])), (d * 3), (d * 3).maxlen)
d *= 2; print(d)
z = deque([1, 2, 3], 0); print(z, z.maxlen, len(z))
z.append(1); z.appendleft(2); z.extend([1, 2]); print(z)
it = iter([1, 2, 3]); z.extend(it); print(list(it))
it = iter([1, 2, 3]); z.extendleft(it); print(list(it))
t(lambda: z.insert(0, 1))
print(deque([1], maxlen=None).maxlen, deque(maxlen=5), deque(iterable="ab"), deque("ab", maxlen=1))
print(deque([5], 10) * 100)
print(deque([5, 6], 5) * 100)
t(lambda: deque([], -1)); t(lambda: deque([], "a")); t(lambda: deque([], 1.0)); t(lambda: deque([], 2 ** 64)); t(lambda: deque(1))
t(lambda: deque([], 1, 2)); t(lambda: deque(x=1)); t(lambda: deque([], iterable=[])); t(lambda: deque(maxlenn=1))
print(deque([], 2 ** 62).maxlen, deque([], True).maxlen)
tn(lambda: setattr(d, "maxlen", 4))
tn(lambda: delattr(d, "maxlen"))
d = deque([1, 2, 3], 5)
d.__init__([9]); print(d, d.maxlen)
d.__init__(); print(d, d.maxlen)
print(repr(deque([1, "a", None], 7)), str(deque()))
d = deque([1]); d.append(d); print(d)
d = deque([1], 4); d.append(d); print(d)
d = deque([[1, deque([2])]]); print(d)
