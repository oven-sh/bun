x = 5
if x > 3:
    print("big")
if x > 10:
    print("huge")
else:
    print("not huge")
if x == 1:
    print(1)
elif x == 5:
    print(5)
elif x == 6:
    print(6)
else:
    print("other")
if x: print("inline")
if not x: print("no")
else: print("inline else")

i = 0
while i < 5:
    print(i, end=" ")
    i += 1
print()
i = 0
while True:
    i += 1
    if i == 3:
        continue
    if i > 6:
        break
    print(i, end=" ")
print()
i = 0
while i < 3:
    i += 1
else:
    print("while else", i)
while i < 10:
    i += 1
    if i == 5:
        break
else:
    print("not printed")
print(i)
while False:
    print("never")
else:
    print("else of while False")

for i in range(5):
    print(i, end=",")
print()
for i in range(2, 10, 3):
    print(i, end=",")
print()
for i in range(5, 0, -1):
    print(i, end=",")
print()
for c in "abc":
    print(c, end="|")
print()
for item in [1, "two", 3.0, None]:
    print(item, end=" ")
print()
for a, b in [(1, 2), (3, 4)]:
    print(a + b, end=" ")
print()
for k in {"x": 1, "y": 2}:
    print(k, end=" ")
print()
for i in range(3):
    pass
else:
    print("for else", i)
for i in range(3):
    if i == 1:
        break
else:
    print("not printed")
print(i)
for i in []:
    print("never")
else:
    print("empty for else")
for i in range(3):
    for j in range(3):
        if j == 2:
            break
        if i == 1:
            continue
        print(i, j, end="; ")
print()
# The loop variable survives, and assigning to it does not affect the iteration.
for i in range(3):
    i = i * 10
    print(i, end=" ")
print(i)
# Changing a list while iterating over it.
l = [1, 2, 3, 4, 5, 6]
for v in l:
    if v % 2 == 0:
        l.remove(v)
print(l)
l = [1, 2, 3]
for v in l:
    if len(l) < 6:
        l.append(v * 10)
print(l)
total = 0
for i in range(1, 101):
    if i % 3 == 0 and i % 5 == 0:
        total += 15
    elif i % 3 == 0:
        total += 3
    elif i % 5 == 0:
        total += 5
    else:
        total += 1
print(total)
n = 27
steps = 0
while n != 1:
    n = n // 2 if n % 2 == 0 else 3 * n + 1
    steps += 1
print(steps)
primes = []
for n in range(2, 60):
    for p in primes:
        if n % p == 0:
            break
    else:
        primes.append(n)
print(primes)
pass
for i in range(2): pass
while 0: pass
if 1: pass
for i, (a, b) in enumerate([(1, 2), (3, 4)]): print(i, a, b)
for [a, b] in [[1, 2]]: print(a, b)
d = {}
for d["k"] in range(3): pass
print(d)
lst = [0, 0]
for lst[1] in "ab": pass
print(lst)
class O: pass
o = O()
for o.attr in (1, 2): pass
print(o.attr)
for i in range(3):
    try:
        if i == 1:
            continue
        print("body", i)
    finally:
        print("finally", i)
for i in range(3):
    try:
        if i == 1:
            break
    finally:
        print("fin", i)
