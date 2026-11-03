try: x = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = 5')
try:
    if x > 3:
        try: print("big")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "big"')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if x > 3:')
try:
    if x > 10:
        try: print("huge")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "huge"')
    else:
        try: print("not huge")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "not huge"')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if x > 10:')
try:
    if x == 1:
        try: print(1)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1')
    elif x == 5:
        try: print(5)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 5')
    elif x == 6:
        try: print(6)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 6')
    else:
        try: print("other")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "other"')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if x == 1:')
try:
    if x: print("inline")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if x: print("inline")')
try:
    if not x: print("no")
    else: print("inline else")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if not x: print("no")')

try: i = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i = 0')
try:
    while i < 5:
        try: print(i, end=" ")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(i, end=" ")')
        try: i += 1
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i += 1')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while i < 5:')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try: i = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i = 0')
try:
    while True:
        try: i += 1
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i += 1')
        if i == 3:
            continue
        if i > 6:
            break
        try: print(i, end=" ")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(i, end=" ")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while True:')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try: i = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i = 0')
try:
    while i < 3:
        try: i += 1
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i += 1')
    else:
        try: print("while else", 'i =>', i)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while i < 3:')
try:
    while i < 10:
        try: i += 1
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i += 1')
        if i == 5:
            break
    else:
        try: print("not printed")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "not printed"')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while i < 10:')
try: print(i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i')
try:
    while False:
        try: print("never")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "never"')
    else:
        try: print("else of while False")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "else of while False"')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while False:')

try:
    for i in range(5):
        try: print(i, end=",")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(i, end=",")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(5):')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    for i in range(2, 10, 3):
        try: print(i, end=",")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(i, end=",")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(2, 10, 3):')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    for i in range(5, 0, -1):
        try: print(i, end=",")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(i, end=",")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(5, 0, -1):')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    for c in "abc":
        try: print(c, end="|")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(c, end="|")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for c in "abc":')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    for item in [1, "two", 3.0, None]:
        try: print(item, end=" ")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(item, end=" ")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for item in [1, "two", 3.0, None]:')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    for a, b in [(1, 2), (3, 4)]:
        try: print(a + b, end=" ")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(a + b, end=" ")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for a, b in [(1, 2), (3, 4)]:')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    for k in {"x": 1, "y": 2}:
        try: print(k, end=" ")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(k, end=" ")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for k in {"x": 1, "y": 2}:')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    for i in range(3):
        pass
    else:
        try: print("for else", 'i =>', i)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(3):')
try:
    for i in range(3):
        if i == 1:
            break
    else:
        try: print("not printed")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "not printed"')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(3):')
try: print(i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i')
try:
    for i in []:
        try: print("never")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "never"')
    else:
        try: print("empty for else")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "empty for else"')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in []:')
try:
    for i in range(3):
        for j in range(3):
            if j == 2:
                break
            if i == 1:
                continue
            try: print(i, j, end="; ")
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(i, j, end="; ")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(3):')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
# The loop variable survives, and assigning to it does not affect the iteration.
try:
    for i in range(3):
        try: i = i * 10
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i = i * 10')
        try: print(i, end=" ")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(i, end=" ")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(3):')
try: print(i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i')
# Changing a list while iterating over it.
try: l = [1, 2, 3, 4, 5, 6]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l = [1, 2, 3, 4, 5, 6]')
try:
    for v in l:
        if v % 2 == 0:
            try: l.remove(v)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l.remove(v)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for v in l:')
try: print(l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l')
try: l = [1, 2, 3]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l = [1, 2, 3]')
try:
    for v in l:
        if len(l) < 6:
            try: l.append(v * 10)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l.append(v * 10)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for v in l:')
try: print(l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l')
try: total = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: total = 0')
try:
    for i in range(1, 101):
        if i % 3 == 0 and i % 5 == 0:
            try: total += 15
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: total += 15')
        elif i % 3 == 0:
            try: total += 3
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: total += 3')
        elif i % 5 == 0:
            try: total += 5
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: total += 5')
        else:
            try: total += 1
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: total += 1')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(1, 101):')
try: print(total)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: total')
try: n = 27
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n = 27')
try: steps = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: steps = 0')
try:
    while n != 1:
        try: n = n // 2 if n % 2 == 0 else 3 * n + 1
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n = n // 2 if n % 2 == 0 else 3 * n + 1')
        try: steps += 1
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: steps += 1')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while n != 1:')
try: print(steps)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: steps')
try: primes = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: primes = []')
try:
    for n in range(2, 60):
        for p in primes:
            if n % p == 0:
                break
        else:
            try: primes.append(n)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: primes.append(n)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for n in range(2, 60):')
try: print(primes)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: primes')
pass
try:
    for i in range(2): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(2): pass')
try:
    while 0: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: while 0: pass')
try:
    if 1: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: if 1: pass')
try:
    for i, (a, b) in enumerate([(1, 2), (3, 4)]): print(i, a, b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i, (a, b) in enumerate([(1, 2), (3, 4)]): print(i, a, b)')
try:
    for [a, b] in [[1, 2]]: print(a, b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for [a, b] in [[1, 2]]: print(a, b)')
try: d = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = {}')
try:
    for d["k"] in range(3): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for d["k"] in range(3): pass')
try: print(d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d')
try: lst = [0, 0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lst = [0, 0]')
try:
    for lst[1] in "ab": pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for lst[1] in "ab": pass')
try: print(lst)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lst')
try:
    class O: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class O: pass')
try: o = O()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = O()')
try:
    for o.attr in (1, 2): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for o.attr in (1, 2): pass')
try: print(o.attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.attr')
try:
    for i in range(3):
        try:
            if i == 1:
                continue
            print("body", 'i [' + 'i=' + (repr(i) if type(i) in (str, int, float, bytes, bool, type(None)) or (type(i) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in i)) else i.__name__ if type(i) is type else type(i).__name__) + '] =>', i)
        finally:
            print("finally", 'i [' + 'i=' + (repr(i) if type(i) in (str, int, float, bytes, bool, type(None)) or (type(i) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in i)) else i.__name__ if type(i) is type else type(i).__name__) + '] =>', i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(3):')
try:
    for i in range(3):
        try:
            if i == 1:
                break
        finally:
            print("fin", 'i [' + 'i=' + (repr(i) if type(i) in (str, int, float, bytes, bool, type(None)) or (type(i) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in i)) else i.__name__ if type(i) is type else type(i).__name__) + '] =>', i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(3):')
