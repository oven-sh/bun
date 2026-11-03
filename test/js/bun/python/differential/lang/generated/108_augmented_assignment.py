try:
    def t(f):
        try:
            print(repr(f()))
        except Exception as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try: x = 10
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = 10')
try: x += 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x += 5')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x -= 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x -= 3')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x *= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x *= 2')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x /= 4
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x /= 4')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x //= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x //= 2')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x **= 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x **= 3')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x %= 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x %= 5')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x = 12
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = 12')
try: x &= 10
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x &= 10')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x |= 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x |= 5')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x ^= 6
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x ^= 6')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x <<= 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x <<= 3')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x >>= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x >>= 2')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x = 7
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = 7')
try: x //= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x //= 2')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x = -7
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = -7')
try: x //= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x //= 2')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x = 7
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = 7')
try: x %= -3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x %= -3')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = 2')
try: x **= -1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x **= -1')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = 2')
try: x **= 100
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x **= 100')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x = 2 ** 62
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = 2 ** 62')
try: x += 2 ** 62
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x += 2 ** 62')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x = 2 ** 63
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = 2 ** 63')
try: x -= 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x -= 1')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x = 10 ** 20
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = 10 ** 20')
try: x //= 10 ** 19
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x //= 10 ** 19')
try: print('x =>', x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: print('type(x) =>', type(x))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(x)')
try: s = "a"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = "a"')
try: s += "b"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s += "b"')
try: print(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s')
try: s *= 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s *= 3')
try: print(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s')
try: s %= ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s %= ()')
try: print(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s')
try: s = "%d"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = "%d"')
try: s %= 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s %= 5')
try: print(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s')
try: f = 1.5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f = 1.5')
try: f += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f += 1')
try: print(f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f')
try: f *= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f *= 2')
try: print(f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f')
try: f //= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f //= 2')
try: print(f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f')
try: f **= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f **= 2')
try: print(f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f')
try: f %= 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f %= 3')
try: print(f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f')
try: b = True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b = True')
try: b += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b += 1')
try: print('b =>', b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b')
try: print('type(b) =>', type(b))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(b)')
try: b = True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b = True')
try: b &= False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b &= False')
try: print('b =>', b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b')
try: print('type(b) =>', type(b))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(b)')
try: b = True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b = True')
try: b |= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b |= 2')
try: print('b =>', b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b')
try: print('type(b) =>', type(b))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(b)')
try: c = 1j
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = 1j')
try: c *= 1j
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c *= 1j')
try: print(c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c')
try: c += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c += 1')
try: print(c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c')
# Mutable objects are changed in place; immutable ones are rebound.
try: l = [1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l = [1]')
try: a = l
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = l')
try: l += [2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l += [2]')
try: print('l =>', l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l')
try: print('a =>', a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a')
try: print('l is a =>', l is a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l is a')
try: l = l + [3]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l = l + [3]')
try: print('l =>', l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l')
try: print('a =>', a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a')
try: print('l is a =>', l is a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l is a')
try: l = [1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l = [1]')
try: a = l
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = l')
try: l *= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l *= 2')
try: print('l =>', l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l')
try: print('a =>', a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a')
try: print('l is a =>', l is a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l is a')
try: tp = (1,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp = (1,)')
try: a = tp
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = tp')
try: tp += (2,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp += (2,)')
try: print('tp =>', tp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp')
try: print('a =>', a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a')
try: print('tp is a =>', tp is a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp is a')
try: tp *= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp *= 2')
try: print(tp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp')
try: st = {1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: st = {1}')
try: a = st
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = st')
try: st |= {2}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: st |= {2}')
try: print('st =>', st)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: st')
try: print('a is st =>', a is st)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a is st')
try: st &= {2}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: st &= {2}')
try: print('st =>', st)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: st')
try: print('a is st =>', a is st)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a is st')
try: st ^= {3}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: st ^= {3}')
try: print('st =>', st)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: st')
try: print('a is st =>', a is st)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a is st')
try: st -= {2}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: st -= {2}')
try: print('st =>', st)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: st')
try: print('a is st =>', a is st)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a is st')
try: fs = frozenset({1})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fs = frozenset({1})')
try: a = fs
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = fs')
try: fs |= {2}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fs |= {2}')
try: print('fs =>', fs)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fs')
try: print('a =>', a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a')
try: print('a is fs =>', a is fs)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a is fs')
try: d = {1: 1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = {1: 1}')
try: a = d
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = d')
try: d |= {2: 2}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d |= {2: 2}')
try: print('d =>', d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d')
try: print('a is d =>', a is d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a is d')
try: ba = bytearray(b"a")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ba = bytearray(b"a")')
try: a = ba
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = ba')
try: ba += b"b"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ba += b"b"')
try: print('ba =>', ba)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ba')
try: print('a is ba =>', a is ba)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a is ba')
try: ba *= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ba *= 2')
try: print('ba =>', ba)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ba')
try: print('a is ba =>', a is ba)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a is ba')
try: by = b"a"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: by = b"a"')
try: a = by
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = by')
try: by += b"b"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: by += b"b"')
try: print('by =>', by)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: by')
try: print('a =>', a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a')
try: s = "a"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = "a"')
try: a = s
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = s')
try: s += "b"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s += "b"')
try: print('s =>', s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s')
try: print('a =>', a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a')
# list += accepts any iterable, list + does not.
try: l = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l = []')
try: l += "ab"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l += "ab"')
try: l += (1, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l += (1, 2)')
try: l += {3: 4}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l += {3: 4}')
try: l += range(2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l += range(2)')
try: l += (x for x in [9])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l += (x for x in [9])')
try: print(l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l')
try:
    def f1():
        l = []; l += 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f1():')
try:
    def f2():
        l = []; l = l + "ab"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f2():')
try:
    def f3():
        l = []; l += None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f3():')
try:
    def f4():
        tp = (); tp += [1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f4():')
try:
    def f5():
        s = ""; s += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f5():')
try:
    def f6():
        x = 1; x += "a"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f6():')
try:
    def f7():
        x = None; x += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f7():')
try:
    def f8():
        d = {}; d += {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f8():')
try:
    def f9():
        d = {}; d |= [1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f9():')
try:
    def f10():
        d = {}; d |= [(1, 2)]; return d
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f10():')
try:
    def f11():
        st = set(); st |= [1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f11():')
try:
    def f12():
        st = set(); st += {1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f12():')
try:
    def f13():
        l = [1]; l *= "a"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f13():')
try:
    def f14():
        l = [1]; l -= [1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f14():')
try:
    def f15():
        x = 1; x /= 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f15():')
try:
    def f16():
        x = 1; x @= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f16():')
try:
    def f17():
        x = 1.5; x <<= 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f17():')
try:
    def f18():
        x = "a"; x -= "a"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f18():')
try:
    def f19():
        undefined_aug += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f19():')
try:
    def f20():
        loc += 1; loc = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f20():')
try:
    def f21():
        x = 1; x **= "a"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f21():')
try:
    def f22():
        x = [1]; x //= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f22():')
try:
    def f23():
        x = 5; x >>= -1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f23():')
try:
    def f24():
        x = object(); x += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f24():')
try:
    def f25():
        x = 1; x %= 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f25():')
try:
    for f in (f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13, f14, f15, f16, f17, f18, f19, f20, f21, f22, f23, f24, f25): t(f)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13, f14...')
# Targets.
try: l = [1, 2, 3]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l = [1, 2, 3]')
try: l[0] += 10
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l[0] += 10')
try: l[-1] *= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l[-1] *= 2')
try: print(l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l')
try: l[1:2] += [7, 8]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l[1:2] += [7, 8]')
try: print(l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l')
try: l[:] *= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l[:] *= 2')
try: print(l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l')
try: l[::2] = [0] * len(l[::2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l[::2] = [0] * len(l[::2])')
try: print(l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: l')
try: d = {"a": 1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = {"a": 1}')
try: d["a"] += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d["a"] += 1')
try: print(d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d')
try: print('exec("d[\'zz\'] += 1", {"d": d}) =>', end=" "); t(lambda: exec("d['zz'] += 1", {"d": d}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("d[\'zz\'] += 1", {"d": d}))')
try: d["l"] = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d["l"] = []')
try: d["l"] += [1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d["l"] += [1]')
try: d["l"].append(2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d["l"].append(2)')
try: print(d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d')
try:
    class O: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class O: pass')
try: o = O()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = O()')
try: o.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.x = 1')
try: o.x += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.x += 1')
try: print(o.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.x')
try: print('exec("o.nope += 1", {"o": o}) =>', end=" "); t(lambda: exec("o.nope += 1", {"o": o}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: exec("o.nope += 1", {"o": o}))')
try:
    class CA: n = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CA: n = 0')
try: c1 = CA()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1 = CA()')
try: c1.n += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1.n += 1')
try: print('c1.n =>', c1.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1.n')
try: print('CA.n =>', CA.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: CA.n')
try: print('c1.__dict__ =>', c1.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1.__dict__')
try: CA.n += 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: CA.n += 5')
try: print('c1.n =>', c1.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c1.n')
try: print('CA.n =>', CA.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: CA.n')
try: print('CA().n =>', CA().n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: CA().n')
try:
    class CL: l = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CL: l = []')
try: c2 = CL()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2 = CL()')
try: c2.l += [1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2.l += [1]')
try: print('c2.l =>', c2.l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2.l')
try: print('CL.l =>', CL.l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: CL.l')
try: print('c2.__dict__ =>', c2.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2.__dict__')
try: print('c2.l is CL.l =>', c2.l is CL.l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c2.l is CL.l')
try: nested = {"a": [{"b": 1}]}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nested = {"a": [{"b": 1}]}')
try: nested["a"][0]["b"] += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nested["a"][0]["b"] += 1')
try: print(nested)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: nested')
try: m = [[0] * 2 for _ in range(2)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m = [[0] * 2 for _ in range(2)]')
try: m[0][1] += 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m[0][1] += 5')
try: m[1][0] -= 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m[1][0] -= 5')
try: print(m)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m')
# A tuple holding a list: the in-place operation succeeds, then the store fails.
try: tp = ([1],)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp = ([1],)')
try:
    try: tp[0] += [2]
    except TypeError as e: print("TypeError:", e, tp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: tp[0] += [2]')
try: tp = ([1],)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp = ([1],)')
try: tp[0].extend([2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp[0].extend([2])')
try: print(tp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tp')
# __iadd__ and friends.
try:
    class I:
        def __init__(s, v): s.v = v
        def __iadd__(s, o): s.v += o; return s
        def __isub__(s, o): return I(s.v - o)
        def __imul__(s, o): return "replaced by a string"
        def __itruediv__(s, o): return None
        def __ifloordiv__(s, o): return NotImplemented
        def __floordiv__(s, o): return "fell back to __floordiv__"
        def __imod__(s, o): return NotImplemented
        def __ipow__(s, o): return ("ipow", o)
        def __imatmul__(s, o): return ("imatmul", o)
        def __ilshift__(s, o): return ("ilshift", o)
        def __irshift__(s, o): return ("irshift", o)
        def __iand__(s, o): return ("iand", o)
        def __ior__(s, o): return ("ior", o)
        def __ixor__(s, o): return ("ixor", o)
        def __repr__(s): return "I(%r)" % s.v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class I:')
try: i = I(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i = I(1)')
try: a = i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = i')
try: i += 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i += 5')
try: print('i =>', i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i')
try: print('a is i =>', a is i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a is i')
try: i -= 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i -= 1')
try: print('i =>', i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i')
try: print('a is i =>', a is i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a is i')
try: print('a =>', a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a')
try: i *= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i *= 2')
try: print(i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i')
try: i = I(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i = I(1)')
try: i /= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i /= 2')
try: print(i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i')
try: i = I(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i = I(1)')
try: i //= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i //= 2')
try: print(i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i')
try:
    def imod():
        i = I(1); i %= 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def imod():')
try: print('imod() =>', end=" "); t(imod)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(imod)')
try:
    class RM:
        def __rmod__(s, o): return "right operand's __rmod__"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class RM:')
try: i = I(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i = I(1)')
try: i %= RM()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i %= RM()')
try: print(i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i')
try:
    for op in ("**=", "@=", "<<=", ">>=", "&=", "|=", "^="):
        try: ns = {"i": I(1)}
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns = {"i": I(1)}')
        try: exec("i %s 3" % op, ns)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exec("i %s 3" % op, ns)')
        try: print(ns["i"], end=" ")
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(ns["i"], end=" ")')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for op in ("**=", "@=", "<<=", ">>=", "&=", "|=", "^="):')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    class OnlyAdd:
        def __init__(s, v): s.v = v
        def __add__(s, o): return OnlyAdd(s.v + o)
        def __repr__(s): return "OnlyAdd(%r)" % s.v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class OnlyAdd:')
try: x = OnlyAdd(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = OnlyAdd(1)')
try: a = x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = x')
try: x += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x += 1')
try: print('x =>', x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: print('a =>', a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a')
try: print('x is a =>', x is a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x is a')
try:
    class OnlyRadd:
        def __radd__(s, o): return ("radd", o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class OnlyRadd:')
try: x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = 1')
try: x += OnlyRadd()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x += OnlyRadd()')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try: x = [1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = [1]')
try: x += OnlyRadd() if False else [2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x += OnlyRadd() if False else [2]')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
try:
    def list_iadd_radd():
        x = [1]; x += OnlyRadd(); return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def list_iadd_radd():')
try: print('list_iadd_radd() =>', end=" "); t(list_iadd_radd)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(list_iadd_radd)')
try:
    class IRaises:
        def __iadd__(s, o): raise ValueError("iadd failed")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class IRaises:')
try:
    def ir():
        x = IRaises(); x += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ir():')
try: print('ir() =>', end=" "); t(ir)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(ir)')
# Properties and descriptors: get, then set.
try:
    class P:
        def __init__(s): s._v = 1
        @property
        def v(s): print("get", end="; "); return s._v
        @v.setter
        def v(s, x): print("set", x, end="; "); s._v = x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class P:')
try: p = P()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p = P()')
try: p.v += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.v += 1')
try: p.v *= 10
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.v *= 10')
try: print(p._v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p._v')
try:
    class RO:
        @property
        def v(s): return [1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class RO:')
try:
    def ro():
        r = RO(); r.v += [2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ro():')
try: print('ro() =>', end=" "); t(ro)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(ro)')
try:
    class It:
        def __init__(s): s.d = {}
        def __getitem__(s, k): print("getitem", k, end="; "); return s.d.get(k, 0)
        def __setitem__(s, k, v): print("setitem", k, v, end="; "); s.d[k] = v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class It:')
try: it = It()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it = It()')
try: it["a"] += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it["a"] += 1')
try: it["a"] += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it["a"] += 1')
try: it[1, 2] += 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it[1, 2] += 5')
try: it[1:2] += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it[1:2] += 1')
try: print(it.d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it.d')
# Scoping.
try: g = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = 1')
try:
    def use_global():
        global g
        g += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def use_global():')
try: use_global()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: use_global()')
try: print(g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g')
try:
    def closure():
        n = 0
        def inc():
            nonlocal n
            n += 1
            return n
        return inc(), inc(), n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def closure():')
try: print(closure())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: closure()')
try:
    def no_nonlocal():
        n = 0
        def inc(): n += 1
        inc()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def no_nonlocal():')
try: print('no_nonlocal() =>', end=" "); t(no_nonlocal)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(no_nonlocal)')
try:
    class Body:
        v = 1; v += 1
        g += 100
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Body:')
try: print('Body.v =>', Body.v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Body.v')
try: print('Body.g =>', Body.g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Body.g')
try: print('g =>', g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g')
try:
    for i in range(3): i += 10
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(3): i += 10')
try: print(i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i')
try: acc = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: acc = 0')
try:
    for v in range(5): acc += v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for v in range(5): acc += v')
try: print(acc)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: acc')
try: r = [0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = [0]')
try: [r.__setitem__(0, r[0] + v) for v in range(4)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [r.__setitem__(0, r[0] + v) for v in range(4)]')
try: print(r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r')
try: w = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w = 0')
try: print('[(w := w + v) for v in range(4)] =>', [(w := w + v) for v in range(4)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [(w := w + v) for v in range(4)]')
try: print('w =>', w)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w')
try:
    for src in ("x += 1", "x + = 1", "x =+ 1", "x += += 1", "x += y += 1", "x = y += 1", "x += y = 1", "(x) += 1", "((x)) += 1", "(x, y) += 1", "x, y += 1", "[x] += 1", "[x, y] += 1", "x() += 1", "x.y() += 1", "1 += 1", "'a' += 'b'", "None += 1", "x + y += 1", "-x += 1", "x[0] += 1", "x.y += 1", "x[0].y[1] += 1", "x[1:2] += y", "*x += 1", "x += *y", "x += *y, z", "x += y, z", "x += (yield)", "x += yield", "def f(): x += yield", "x += lambda: 1", "x += y if z else w", "x if y else z += 1", "x: int += 1", "x += 1: int", "(x := 1) += 1", "x += (y := 1)", "x += y := 1", "x ++", "x++", "++x", "x --", "--x", "x **= 2", "x //= 2", "x >>= 1", "x <<= 1", "x @= y", "x &&= y", "x ||= y", "x ??= y", "x ^= y", "x ~= y", "x != 1", "x %= y", "x >>>= 1", "x ***= 1", "x ///= 1", "f(x += 1)", "[x += 1]", "print(x += 1)", "if x += 1: pass", "lambda: x += 1", "x += 1; y -= 1", "x += 1,", "del x += 1", "for x += 1 in y: pass", "with x as y += 1: pass", "x.__debug__ += 1", "__debug__ += 1", "True += 1", "... += 1", "f'{x}' += 'a'", "{x} += 1", "{} += 1", "x < y += 1", "not x += 1", "await x += 1"):
        try: compile(src, "<s>", "exec"); print("ok:", src)
        except SyntaxError as e: print("SyntaxError:", e.msg, "<-", src)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("x += 1", "x + = 1", "x =+ 1", "x += += 1", "x += y += 1"...')
