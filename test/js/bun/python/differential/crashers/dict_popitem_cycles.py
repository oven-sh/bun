# Every slot of the table of a dict must not end up marked as deleted: a lookup would never end.
d = {}
for i in range(1000):
    d[i] = i
    d.popitem()
print(d.get(5000), len(d), 7 in d)
d = {"a": 1}
for i in range(1000):
    d["k%d" % i] = i
    d.popitem()
print(d.get("zzz"), len(d), d)
