import heapq, bisect

def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)

print(sorted(heapq.__all__), heapq.heappush.__module__, bisect.bisect is bisect.bisect_right, bisect.insort is bisect.insort_right, bisect.bisect_left.__module__)
data = [(i * 7919) % 101 for i in range(60)]
h = []
for v in data: heapq.heappush(h, v)
print([heapq.heappop(h) for _ in range(len(h))] == sorted(data))
print(heapq.nlargest(5, data), heapq.nsmallest(5, data), heapq.nlargest(3, data, key=lambda x: -x), heapq.nsmallest(3, data, key=lambda x: x % 10), heapq.nlargest(0, data), heapq.nsmallest(1, data), heapq.nlargest(1, data), heapq.nlargest(100, data) == sorted(data, reverse=True), heapq.nsmallest(100, data) == sorted(data))
print(list(heapq.merge([1, 3, 5], [2, 4, 6], [0, 7])), list(heapq.merge()), list(heapq.merge([1])), list(heapq.merge([5, 3, 1], [6, 4, 2], reverse=True)), list(heapq.merge(["aa", "b"], ["c", "ddd"], key=len)), list(heapq.merge([1, 1], [1, 1])))
x = data[:]; heapq.heapify(x); print(x[0] == min(data), heapq.heapreplace(x, 1000), heapq.heappushpop(x, -1), x[0])
x = data[:]; heapq.heapify_max(x); print(x[0] == max(data), heapq.heappop_max(x), heapq.heapreplace_max(x, -5), heapq.heappushpop_max(x, 1000)); heapq.heappush_max(x, 500); print(x[0])
t(lambda: heapq.heappop([])); t(lambda: heapq.nlargest("a", data)); t(lambda: heapq.heappush(1, 2))
grades = "FDCBA"; print([grades[bisect.bisect([60, 70, 80, 90], s)] for s in (33, 99, 77, 70, 89, 90, 100)])
l = []
for v in data: bisect.insort(l, v)
print(l == sorted(data), bisect.bisect_left(l, 50), bisect.bisect_right(l, 50), bisect.bisect(l, 50, 0, 10), bisect.bisect_left(l, 50, lo=20), bisect.bisect_left(l, -1), bisect.bisect_right(l, 1000))
people = [("a", 30), ("b", 25), ("c", 35)]; people.sort(key=lambda p: p[1]); bisect.insort(people, ("d", 28), key=lambda p: p[1]); print(people, bisect.bisect_left(people, 30, key=lambda p: p[1]))
from collections import deque, UserList
d = deque([1, 3, 5]); bisect.insort(d, 4); print(d, bisect.bisect(d, 3)); u = UserList([1, 3]); bisect.insort_left(u, 2); print(u)
import array
a = array.array("i", [1, 3, 5]); bisect.insort(a, 4); print(a, bisect.bisect_left(a, 3))
