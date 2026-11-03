# Number crunching with arbitrary-precision integers and floats.
try:
    def fact(n):
        r = 1
        for i in range(2, n + 1): r *= i
        return r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fact(n):')
try:
    def fib(n):
        a, b = 0, 1
        for _ in range(n): a, b = b, a + b
        return a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fib(n):')
try:
    def fib_fast(n):
        if n == 0: return (0, 1)
        a, b = fib_fast(n >> 1); c = a * (2 * b - a); d = a * a + b * b
        return (d, c + d) if n & 1 else (c, d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fib_fast(n):')
try:
    def binom(n, k):
        r = 1
        for i in range(min(k, n - k)): r = r * (n - i) // (i + 1)
        return r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def binom(n, k):')
try: print('fact(25) =>', fact(25))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fact(25)')
try: print('fact(100) =>', fact(100))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fact(100)')
try: print('len(str(fact(300))) =>', len(str(fact(300))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(str(fact(300)))')
try: print('sum(map(int, str(fact(100)))) =>', sum(map(int, str(fact(100)))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(map(int, str(fact(100))))')
try: print('fact(50) // fact(48) =>', fact(50) // fact(48))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fact(50) // fact(48)')
try: print('str(fact(200)).count("0") =>', str(fact(200)).count("0"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: str(fact(200)).count("0")')
try: print('len(str(fact(200))) - len(str(fact(200)).rstrip("0")) =>', len(str(fact(200))) - len(str(fact(200)).rstrip("0")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(str(fact(200))) - len(str(fact(200)).rstrip("0"))')
try: print('fib(100) =>', fib(100))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fib(100)')
try: print('fib(300) =>', fib(300))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fib(300)')
try: print('fib_fast(1000)[0] % 10 ** 20 =>', fib_fast(1000)[0] % 10 ** 20)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fib_fast(1000)[0] % 10 ** 20')
try: print('len(str(fib_fast(2000)[0])) =>', len(str(fib_fast(2000)[0])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(str(fib_fast(2000)[0]))')
try: print('fib(90) == fib_fast(90)[0] =>', fib(90) == fib_fast(90)[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fib(90) == fib_fast(90)[0]')
try: print('next(i for i in range(1, 500) if len(str(fib(i))) >= 50) =>', next(i for i in range(1, 500) if len(str(fib(i))) >= 50))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(i for i in range(1, 500) if len(str(fib(i))) >= 50)')
try: print('binom(10, 3) =>', binom(10, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: binom(10, 3)')
try: print('binom(100, 50) =>', binom(100, 50))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: binom(100, 50)')
try: print('binom(200, 100) % 10 ** 9 =>', binom(200, 100) % 10 ** 9)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: binom(200, 100) % 10 ** 9')
try: print('sum(binom(30, k) for k in range(31)) == 2 ** 30 =>', sum(binom(30, k) for k in range(31)) == 2 ** 30)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(binom(30, k) for k in range(31)) == 2 ** 30')
try: print('[binom(8, k) for k in range(9)] =>', [binom(8, k) for k in range(9)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [binom(8, k) for k in range(9)]')
try: print('2 ** 200 =>', 2 ** 200)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 2 ** 200')
try: print('3 ** 150 =>', 3 ** 150)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 3 ** 150')
try: print('7 ** 77 % 10 ** 10 =>', 7 ** 77 % 10 ** 10)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 7 ** 77 % 10 ** 10')
try: print('2 ** 127 - 1 =>', 2 ** 127 - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 2 ** 127 - 1')
try: print('(10 ** 50 + 1) * (10 ** 50 - 1) =>', (10 ** 50 + 1) * (10 ** 50 - 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (10 ** 50 + 1) * (10 ** 50 - 1)')
try: print('(10 ** 40) // 7 =>', (10 ** 40) // 7)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (10 ** 40) // 7')
try: print('(10 ** 40) % 7 =>', (10 ** 40) % 7)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (10 ** 40) % 7')
try: print('-(10 ** 40) // 7 =>', -(10 ** 40) // 7)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: -(10 ** 40) // 7')
try: print('-(10 ** 40) % 7 =>', -(10 ** 40) % 7)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: -(10 ** 40) % 7')
try: print('divmod(10 ** 30, -(10 ** 15 + 3)) =>', divmod(10 ** 30, -(10 ** 15 + 3)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: divmod(10 ** 30, -(10 ** 15 + 3))')
try: print('2 ** 100 >> 90 =>', 2 ** 100 >> 90)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 2 ** 100 >> 90')
try: print('1 << 130 =>', 1 << 130)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1 << 130')
try: print('(1 << 130) - 1 & (1 << 65) - 1 =>', (1 << 130) - 1 & (1 << 65) - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (1 << 130) - 1 & (1 << 65) - 1')
try: print('(2 ** 70) ^ (2 ** 69 + 12345) =>', (2 ** 70) ^ (2 ** 69 + 12345))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (2 ** 70) ^ (2 ** 69 + 12345)')
try: print('~(2 ** 80) =>', ~(2 ** 80))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ~(2 ** 80)')
try: print('(2 ** 64 - 1).bit_length() =>', (2 ** 64 - 1).bit_length())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (2 ** 64 - 1).bit_length()')
try: print('(2 ** 64).bit_length() =>', (2 ** 64).bit_length())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (2 ** 64).bit_length()')
try: print('bin(2 ** 70 + 5).count("1") =>', bin(2 ** 70 + 5).count("1"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bin(2 ** 70 + 5).count("1")')
try: print('(123456789 ** 5).bit_count() =>', (123456789 ** 5).bit_count())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (123456789 ** 5).bit_count()')
try:
    def isqrt(n):
        if n < 2: return n
        x = 1 << (n.bit_length() + 1) // 2
        while True:
            y = (x + n // x) // 2
            if y >= x: return x
            x = y
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def isqrt(n):')
try:
    def iroot(n, k):
        lo, hi = 0, 1 << (n.bit_length() // k + 1)
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if mid ** k <= n: lo = mid
            else: hi = mid - 1
        return lo
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def iroot(n, k):')
try: print('isqrt(10 ** 40) =>', isqrt(10 ** 40))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isqrt(10 ** 40)')
try: print('isqrt(2 * 10 ** 60) =>', isqrt(2 * 10 ** 60))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isqrt(2 * 10 ** 60)')
try: print('isqrt(10 ** 40 - 1) =>', isqrt(10 ** 40 - 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isqrt(10 ** 40 - 1)')
try: print('isqrt(99) =>', isqrt(99))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isqrt(99)')
try: print('isqrt(2 ** 200 + 1) == 2 ** 100 =>', isqrt(2 ** 200 + 1) == 2 ** 100)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isqrt(2 ** 200 + 1) == 2 ** 100')
try: print('iroot(10 ** 30, 3) =>', iroot(10 ** 30, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: iroot(10 ** 30, 3)')
try: print('iroot(2 ** 100, 7) =>', iroot(2 ** 100, 7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: iroot(2 ** 100, 7)')
try: print('iroot(10 ** 50, 5) =>', iroot(10 ** 50, 5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: iroot(10 ** 50, 5)')
try: print('[isqrt(n) for n in range(17)] =>', [isqrt(n) for n in range(17)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [isqrt(n) for n in range(17)]')
try:
    def pi_digits(n):
        "Gibbons' unbounded spigot."
        q, r, t, k, m, x = 1, 0, 1, 1, 3, 3; out = []
        while len(out) < n:
            if 4 * q + r - t < m * t: out.append(m); q, r, m = 10 * q, 10 * (r - m * t), (10 * (3 * q + r)) // t - 10 * m
            else: q, r, t, k, m, x = q * k, (2 * q + r) * x, t * x, k + 1, (q * (7 * k + 2) + r * x) // (t * x), x + 2
        return "".join(map(str, out))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def pi_digits(n):')
try:
    def e_digits(n):
        scale = 10 ** (n + 10); term = scale; total = 0; k = 0
        while term: total += term; k += 1; term //= k
        return str(total)[:n]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def e_digits(n):')
try:
    def machin_pi(n):
        scale = 10 ** (n + 10)
        def arctan_inv(x):
            total = term = scale // x; x2 = x * x; k = 1; sign = -1
            while term: term //= x2; k += 2; total += sign * (term // k); sign = -sign
            return total
        return str(4 * (4 * arctan_inv(5) - arctan_inv(239)))[:n]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def machin_pi(n):')
try: print(pi_digits(60))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pi_digits(60)')
try: print(machin_pi(100))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: machin_pi(100)')
try: print(e_digits(100))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e_digits(100)')
try: print(str(isqrt(2 * 10 ** 200))[:100])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: str(isqrt(2 * 10 ** 200))[:100]')
try: print(pi_digits(40) == machin_pi(40))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pi_digits(40) == machin_pi(40)')
try:
    def modpow(b, e, m):
        r = 1; b %= m
        while e:
            if e & 1: r = r * b % m
            b = b * b % m; e >>= 1
        return r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def modpow(b, e, m):')
try:
    def miller_rabin(n):
        if n < 2: return False
        for p in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
            if n % p == 0: return n == p
        d, s = n - 1, 0
        while d % 2 == 0: d //= 2; s += 1
        for a in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
            x = pow(a, d, n)
            if x in (1, n - 1): continue
            for _ in range(s - 1):
                x = x * x % n
                if x == n - 1: break
            else: return False
        return True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def miller_rabin(n):')
try:
    def inverse(a, m):
        g, x, y = m, 0, 1; a %= m
        while a: q = g // a; g, a = a, g - q * a; x, y = y, x - q * y
        if g != 1: raise ValueError("not invertible")
        return x % m
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def inverse(a, m):')
try: print('modpow(2, 1000, 10 ** 9 + 7) == pow(2, 1000, 10 ** 9 + 7) =>', modpow(2, 1000, 10 ** 9 + 7) == pow(2, 1000, 10 ** 9 + 7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: modpow(2, 1000, 10 ** 9 + 7) == pow(2, 1000, 10 ** 9 + 7)')
try: print('modpow(3, 10 ** 30, 10 ** 18 + 9) =>', modpow(3, 10 ** 30, 10 ** 18 + 9))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: modpow(3, 10 ** 30, 10 ** 18 + 9)')
try: print('[n for n in range(100, 150) if miller_rabin(n)] =>', [n for n in range(100, 150) if miller_rabin(n)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [n for n in range(100, 150) if miller_rabin(n)]')
try: print('[miller_rabin(n) for n in (2 ** 61 - 1, 2 ** 89 - 1, 2 ** 67 - 1, 561... =>', [miller_rabin(n) for n in (2 ** 61 - 1, 2 ** 89 - 1, 2 ** 67 - 1, 561, 41041, 10 ** 18 + 9, 10 ** 18 + 11, 2 ** 127 - 1, 3215031751)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [miller_rabin(n) for n in (2 ** 61 - 1, 2 ** 89 - 1, 2 ** 67 - 1, 561...')
try: print('inverse(3, 11) =>', inverse(3, 11))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inverse(3, 11)')
try: print('inverse(10 ** 9, 10 ** 9 + 7) =>', inverse(10 ** 9, 10 ** 9 + 7))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inverse(10 ** 9, 10 ** 9 + 7)')
try: print('inverse(17, 3120) == pow(17, -1, 3120) =>', inverse(17, 3120) == pow(17, -1, 3120))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inverse(17, 3120) == pow(17, -1, 3120)')
try: p, q = 2 ** 61 - 1, 2 ** 89 - 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p, q = 2 ** 61 - 1, 2 ** 89 - 1')
try: n = p * q
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n = p * q')
try: phi = (p - 1) * (q - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: phi = (p - 1) * (q - 1)')
try: e = 65537
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = 65537')
try: d = inverse(e, phi)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = inverse(e, phi)')
try: msg = int.from_bytes(b"attack at dawn", "big")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: msg = int.from_bytes(b"attack at dawn", "big")')
try: c = pow(msg, e, n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = pow(msg, e, n)')
try: print('n =>', n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n')
try: print('c =>', c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c')
try: print('pow(c, d, n).to_bytes(14, "big") =>', pow(c, d, n).to_bytes(14, "big"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pow(c, d, n).to_bytes(14, "big")')
try:
    def pollard(n):
        x = y = 2; d = 1
        def gcd(a, b):
            while b: a, b = b, a % b
            return a
        while d == 1: x = (x * x + 1) % n; y = (y * y + 1) % n; y = (y * y + 1) % n; d = gcd(abs(x - y), n)
        return d
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def pollard(n):')
try: print('pollard(8051) =>', pollard(8051))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pollard(8051)')
try: print('pollard(10403) =>', pollard(10403))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pollard(10403)')
try: print('sorted((pollard(1000003 * 1000033), 1000003 * 1000033 // pollard(1000... =>', sorted((pollard(1000003 * 1000033), 1000003 * 1000033 // pollard(1000003 * 1000033))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted((pollard(1000003 * 1000033), 1000003 * 1000033 // pollard(1000...')
try:
    def crt(rs, ms):
        x, m = 0, 1
        for r, mod in zip(rs, ms): x += m * ((r - x) * inverse(m, mod) % mod); m *= mod
        return x, m
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def crt(rs, ms):')
try: print('crt([2, 3, 2], [3, 5, 7]) =>', crt([2, 3, 2], [3, 5, 7]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: crt([2, 3, 2], [3, 5, 7])')
try: print('crt([1, 2, 3, 4], [10 ** 9 + 7, 10 ** 9 + 9, 998244353, 2 ** 31 - 1]) =>', crt([1, 2, 3, 4], [10 ** 9 + 7, 10 ** 9 + 9, 998244353, 2 ** 31 - 1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: crt([1, 2, 3, 4], [10 ** 9 + 7, 10 ** 9 + 9, 998244353, 2 ** 31 - 1])')
try:
    def to_frac(digits, rep=""):
        "0.digits(rep) as a reduced fraction."
        a = int(digits + rep or "0") - (int(digits or "0") if rep else 0); b = (10 ** len(rep) - 1 if rep else 1) * 10 ** len(digits)
        x, y = a, b
        while y: x, y = y, x % y
        return a // x, b // x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def to_frac(digits, rep=""):')
try:
    def period(d):
        seen = {}; r = 1; i = 0; out = ""
        while r and r not in seen: seen[r] = i; r *= 10; out += str(r // d); r %= d; i += 1
        return (out, "") if not r else (out[:seen[r]], out[seen[r]:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def period(d):')
try: print('to_frac("25") =>', to_frac("25"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: to_frac("25")')
try: print('to_frac("", "3") =>', to_frac("", "3"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: to_frac("", "3")')
try: print('to_frac("1", "6") =>', to_frac("1", "6"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: to_frac("1", "6")')
try: print('to_frac("", "142857") =>', to_frac("", "142857"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: to_frac("", "142857")')
try: print('[period(d) for d in (2, 3, 6, 7, 8, 12, 13, 17)] =>', [period(d) for d in (2, 3, 6, 7, 8, 12, 13, 17)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [period(d) for d in (2, 3, 6, 7, 8, 12, 13, 17)]')
try: print('max(range(2, 100), key=lambda d: len(period(d)[1])) =>', max(range(2, 100), key=lambda d: len(period(d)[1])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: max(range(2, 100), key=lambda d: len(period(d)[1]))')
try:
    def harmonic(n):
        a, b = 0, 1
        for k in range(1, n + 1): a, b = a * k + b, b * k
        x, y = a, b
        while y: x, y = y, x % y
        return a // x, b // x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def harmonic(n):')
try: h = harmonic(40)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h = harmonic(40)')
try: print('h =>', h)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h')
try: print('h[0] / h[1] =>', h[0] / h[1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h[0] / h[1]')
try: print('len(str(harmonic(100)[0])) =>', len(str(harmonic(100)[0])))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(str(harmonic(100)[0]))')
try:
    def bernoulli(n):
        A = [(0, 1)] * (n + 1)
        def sub(a, b): return (a[0] * b[1] - b[0] * a[1], a[1] * b[1])
        def red(a):
            x, y = abs(a[0]), a[1]
            while y: x, y = y, x % y
            return (a[0] // x, a[1] // x) if x else (0, 1)
        for m in range(n + 1):
            A[m] = (1, m + 1)
            for j in range(m, 0, -1): t = sub(A[j - 1], A[j]); A[j - 1] = red((t[0] * j, t[1]))
        return A[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bernoulli(n):')
try: print([bernoulli(n) for n in (0, 1, 2, 4, 6, 10, 12, 20)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [bernoulli(n) for n in (0, 1, 2, 4, 6, 10, 12, 20)]')
try:
    def partitions(n):
        p = [1] + [0] * n
        for k in range(1, n + 1):
            for i in range(k, n + 1): p[i] += p[i - k]
        return p[n]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def partitions(n):')
try:
    def catalan(n): return binom(2 * n, n) // (n + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def catalan(n): return binom(2 * n, n) // (n + 1)')
try:
    def derange(n): return 1 if n == 0 else 0 if n == 1 else (n - 1) * (derange(n - 1) + derange(n - 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def derange(n): return 1 if n == 0 else 0 if n == 1 else (n - 1) * (d...')
try:
    def stirling2(n, k): return int(n == k) if n == 0 or k == 0 else k * stirling2(n - 1, k) + stirling2(n - 1, k - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def stirling2(n, k): return int(n == k) if n == 0 or k == 0 else k * ...')
try: print('partitions(100) =>', partitions(100))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: partitions(100)')
try: print('partitions(200) =>', partitions(200))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: partitions(200)')
try: print('[catalan(n) for n in range(10)] =>', [catalan(n) for n in range(10)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [catalan(n) for n in range(10)]')
try: print('catalan(50) =>', catalan(50))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: catalan(50)')
try: print('[derange(n) for n in range(9)] =>', [derange(n) for n in range(9)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [derange(n) for n in range(9)]')
try: print('[stirling2(6, k) for k in range(7)] =>', [stirling2(6, k) for k in range(7)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [stirling2(6, k) for k in range(7)]')
try: print('sum(stirling2(8, k) for k in range(9)) =>', sum(stirling2(8, k) for k in range(9)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(stirling2(8, k) for k in range(9))')
try: print('sum(int(c) for c in str(2 ** 1000)) =>', sum(int(c) for c in str(2 ** 1000)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(int(c) for c in str(2 ** 1000))')
try: print('len(str(2 ** 1000)) =>', len(str(2 ** 1000)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(str(2 ** 1000))')
try: print('str(2 ** 1000)[:20] =>', str(2 ** 1000)[:20])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: str(2 ** 1000)[:20]')
try: print('int(str(2 ** 200)[::-1]) =>', int(str(2 ** 200)[::-1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int(str(2 ** 200)[::-1])')
try: print('int("9" * 50) + 1 =>', int("9" * 50) + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int("9" * 50) + 1')
try: print('int("1" * 40) * 9 + 1 =>', int("1" * 40) * 9 + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int("1" * 40) * 9 + 1')
try: print('10 ** 100 // 3 * 3 + 1 == 10 ** 100 =>', 10 ** 100 // 3 * 3 + 1 == 10 ** 100)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 10 ** 100 // 3 * 3 + 1 == 10 ** 100')
try: print('111111111 ** 2 =>', 111111111 ** 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 111111111 ** 2')
try: print('12345679 * 81 =>', 12345679 * 81)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 12345679 * 81')
try: print('(10 ** 18 + 1) ** 3 =>', (10 ** 18 + 1) ** 3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (10 ** 18 + 1) ** 3')
# int <-> float at the edges of precision.
try: print('float(2 ** 53) =>', float(2 ** 53))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: float(2 ** 53)')
try: print('float(2 ** 53 + 1) =>', float(2 ** 53 + 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: float(2 ** 53 + 1)')
try: print('float(2 ** 53 + 2) =>', float(2 ** 53 + 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: float(2 ** 53 + 2)')
try: print('float(2 ** 53 + 3) =>', float(2 ** 53 + 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: float(2 ** 53 + 3)')
try: print('int(1e22) =>', int(1e22))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int(1e22)')
try: print('int(1e23) =>', int(1e23))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int(1e23)')
try: print('int(2.5e15) =>', int(2.5e15))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int(2.5e15)')
try: print('2 ** 53 + 1 == float(2 ** 53 + 1) =>', 2 ** 53 + 1 == float(2 ** 53 + 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 2 ** 53 + 1 == float(2 ** 53 + 1)')
try: print('2 ** 53 == float(2 ** 53) =>', 2 ** 53 == float(2 ** 53))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 2 ** 53 == float(2 ** 53)')
try: print('10 ** 22 == 1e22 =>', 10 ** 22 == 1e22)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 10 ** 22 == 1e22')
try: print('10 ** 23 == 1e23 =>', 10 ** 23 == 1e23)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 10 ** 23 == 1e23')
try: print('10 ** 23 > 1e23 =>', 10 ** 23 > 1e23)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 10 ** 23 > 1e23')
try: print('2 ** 1023 * 2 > 1.7e308 =>', 2 ** 1023 * 2 > 1.7e308)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 2 ** 1023 * 2 > 1.7e308')
try: print('float(10 ** 308) =>', float(10 ** 308))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: float(10 ** 308)')
try: print('10 ** 400 > float("inf") =>', 10 ** 400 > float("inf"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 10 ** 400 > float("inf")')
try: print('-(10 ** 400) < float("-inf") =>', -(10 ** 400) < float("-inf"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: -(10 ** 400) < float("-inf")')
try: print('10 ** 400 > 1e308 =>', 10 ** 400 > 1e308)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 10 ** 400 > 1e308')
try: print('(2 ** 64) / 3 =>', (2 ** 64) / 3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (2 ** 64) / 3')
try: print('(10 ** 30) / (10 ** 10) =>', (10 ** 30) / (10 ** 10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (10 ** 30) / (10 ** 10)')
try: print('(10 ** 400) / (10 ** 399) =>', (10 ** 400) / (10 ** 399))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (10 ** 400) / (10 ** 399)')
try: print('(2 ** 2000) / (2 ** 1999 + 1) =>', (2 ** 2000) / (2 ** 1999 + 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (2 ** 2000) / (2 ** 1999 + 1)')
try: print('1 / 3 ** 50 =>', 1 / 3 ** 50)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1 / 3 ** 50')
try: print('(10 ** 25 + 1) / 10 ** 25 =>', (10 ** 25 + 1) / 10 ** 25)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (10 ** 25 + 1) / 10 ** 25')
try: print('7 ** 400 // 7 ** 398 =>', 7 ** 400 // 7 ** 398)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 7 ** 400 // 7 ** 398')
try: print('(3 ** 100) / (2 ** 100) =>', (3 ** 100) / (2 ** 100))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (3 ** 100) / (2 ** 100)')
try: print('round(10 ** 20 / 3) =>', round(10 ** 20 / 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: round(10 ** 20 / 3)')
try: print('int(10 ** 20 / 3) =>', int(10 ** 20 / 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int(10 ** 20 / 3)')
try: print('10 ** 20 // 3 =>', 10 ** 20 // 3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 10 ** 20 // 3')
try:
    for f in (lambda: float(10 ** 400), lambda: 10 ** 400 / 3, lambda: 10 ** 400 * 1.0, lambda: 1.5 + 10 ** 400, lambda: 2.0 ** 10000, lambda: int(float("inf")), lambda: 10 ** 400 // 0, lambda: 3 ** 10 ** 2 % 0, lambda: (10 ** 400) ** 0.5, lambda: 1 << -1, lambda: 1 >> -1):
        try: print(f())
        except Exception as e: print(type(e).__name__ + ":", e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (lambda: float(10 ** 400), lambda: 10 ** 400 / 3, lambda: 10...')
# Floating-point algorithms.
try:
    def sqrt(x, eps=1e-15):
        g = x or 1.0
        while abs(g * g - x) > eps * x: g = (g + x / g) / 2
        return g
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sqrt(x, eps=1e-15):')
try:
    def exp(x):
        term = total = 1.0; n = 0
        while abs(term) > 1e-17 * abs(total): n += 1; term *= x / n; total += term
        return total
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def exp(x):')
try:
    def ln(x):
        y = (x - 1) / (x + 1); y2 = y * y; term = y; total = 0.0; k = 1
        while abs(term / k) > 1e-17: total += term / k; term *= y2; k += 2
        return 2 * total
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ln(x):')
try:
    def sin(x):
        term = total = x; n = 1
        while abs(term) > 1e-17: term *= -x * x / ((n + 1) * (n + 2)); total += term; n += 2
        return total
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sin(x):')
try:
    def bisect(f, lo, hi):
        for _ in range(60):
            mid = (lo + hi) / 2
            if (f(lo) < 0) == (f(mid) < 0): lo = mid
            else: hi = mid
        return lo
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bisect(f, lo, hi):')
try:
    def newton(f, df, x):
        for _ in range(50):
            step = f(x) / df(x); x -= step
            if abs(step) < 1e-14: break
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def newton(f, df, x):')
try:
    def simpson(f, a, b, n=100):
        h = (b - a) / n
        return h / 3 * (f(a) + f(b) + 4 * sum(f(a + i * h) for i in range(1, n, 2)) + 2 * sum(f(a + i * h) for i in range(2, n, 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def simpson(f, a, b, n=100):')
try: print('sqrt(2) =>', sqrt(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sqrt(2)')
try: print('sqrt(1e10) =>', sqrt(1e10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sqrt(1e10)')
try: print('sqrt(0.25) =>', sqrt(0.25))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sqrt(0.25)')
try: print('exp(1) =>', exp(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exp(1)')
try: print('exp(-1) =>', exp(-1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exp(-1)')
try: print('exp(10) =>', exp(10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exp(10)')
try: print('ln(2) =>', ln(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ln(2)')
try: print('ln(10) =>', ln(10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ln(10)')
try: print('sin(1) =>', sin(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sin(1)')
try: print('sin(3.141592653589793) =>', sin(3.141592653589793))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sin(3.141592653589793)')
try: print('bisect(lambda x: x * x - 2, 0, 2) =>', bisect(lambda x: x * x - 2, 0, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bisect(lambda x: x * x - 2, 0, 2)')
try: print('newton(lambda x: x ** 3 - x - 2, lambda x: 3 * x * x - 1, 1.5) =>', newton(lambda x: x ** 3 - x - 2, lambda x: 3 * x * x - 1, 1.5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: newton(lambda x: x ** 3 - x - 2, lambda x: 3 * x * x - 1, 1.5)')
try: print('simpson(lambda x: x * x, 0, 3) =>', simpson(lambda x: x * x, 0, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: simpson(lambda x: x * x, 0, 3)')
try: print('simpson(sin, 0, 3.141592653589793) =>', simpson(sin, 0, 3.141592653589793))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: simpson(sin, 0, 3.141592653589793)')
try:
    def kahan(xs):
        s = c = 0.0
        for x in xs: y = x - c; t = s + y; c = (t - s) - y; s = t
        return s
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def kahan(xs):')
try: xs = [0.1] * 1000
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: xs = [0.1] * 1000')
try: naive = 0.0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: naive = 0.0')
try:
    for x in xs: naive += x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for x in xs: naive += x')
try: print('naive =>', naive)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: naive')
try: print('kahan(xs) =>', kahan(xs))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kahan(xs)')
try: print('sum(xs) =>', sum(xs))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(xs)')
try: print('naive == 100.0 =>', naive == 100.0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: naive == 100.0')
try: print('kahan(xs) == 100.0 =>', kahan(xs) == 100.0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kahan(xs) == 100.0')
try:
    def mean(a): return sum(a) / len(a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def mean(a): return sum(a) / len(a)')
try:
    def var(a): m = mean(a); return sum((x - m) ** 2 for x in a) / (len(a) - 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def var(a): m = mean(a); return sum((x - m) ** 2 for x in a) / (len(a...')
try:
    def median(a): s = sorted(a); n = len(s); return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def median(a): s = sorted(a); n = len(s); return s[n // 2] if n % 2 e...')
try: sample = [(i * 7919 % 101) / 7 for i in range(50)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sample = [(i * 7919 % 101) / 7 for i in range(50)]')
try: print('mean(sample) =>', mean(sample))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mean(sample)')
try: print('var(sample) =>', var(sample))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: var(sample)')
try: print('var(sample) ** 0.5 =>', var(sample) ** 0.5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: var(sample) ** 0.5')
try: print('median(sample) =>', median(sample))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: median(sample)')
try: print('min(sample) =>', min(sample))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: min(sample)')
try: print('max(sample) =>', max(sample))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: max(sample)')
try: print('round(mean(sample), 3) =>', round(mean(sample), 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: round(mean(sample), 3)')
try: print('"%.6f %.3e %g" % (mean(sample), var(sample), median(sample)) =>', "%.6f %.3e %g" % (mean(sample), var(sample), median(sample)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "%.6f %.3e %g" % (mean(sample), var(sample), median(sample))')
try:
    def solve(a, b):
        "Gaussian elimination with partial pivoting."
        n = len(a); m = [row[:] + [v] for row, v in zip(a, b)]
        for c in range(n):
            p = max(range(c, n), key=lambda r: abs(m[r][c])); m[c], m[p] = m[p], m[c]
            for r in range(c + 1, n):
                f = m[r][c] / m[c][c]
                for k in range(c, n + 1): m[r][k] -= f * m[c][k]
        x = [0.0] * n
        for r in range(n - 1, -1, -1): x[r] = (m[r][n] - sum(m[r][k] * x[k] for k in range(r + 1, n))) / m[r][r]
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def solve(a, b):')
try: print('[round(v, 10) for v in solve([[2.0, 1.0, -1.0], [-3.0, -1.0, 2.0], [-... =>', [round(v, 10) for v in solve([[2.0, 1.0, -1.0], [-3.0, -1.0, 2.0], [-2.0, 1.0, 2.0]], [8.0, -11.0, -3.0])])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [round(v, 10) for v in solve([[2.0, 1.0, -1.0], [-3.0, -1.0, 2.0], [-...')
try: print('[round(v, 8) for v in solve([[4.0, -2.0, 1.0], [-2.0, 4.0, -2.0], [1.... =>', [round(v, 8) for v in solve([[4.0, -2.0, 1.0], [-2.0, 4.0, -2.0], [1.0, -2.0, 4.0]], [11.0, -16.0, 17.0])])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [round(v, 8) for v in solve([[4.0, -2.0, 1.0], [-2.0, 4.0, -2.0], [1....')
try:
    def horner(cs, x):
        r = 0
        for c in cs: r = r * x + c
        return r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def horner(cs, x):')
try: print('horner([1, -3, 0, 2], 4) =>', horner([1, -3, 0, 2], 4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: horner([1, -3, 0, 2], 4)')
try: print('horner([1, 0, -1], 1.5) =>', horner([1, 0, -1], 1.5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: horner([1, 0, -1], 1.5)')
try: print('horner([2, 0, 1], 1j) =>', horner([2, 0, 1], 1j))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: horner([2, 0, 1], 1j)')
try: print('horner([1] * 30, 10) =>', horner([1] * 30, 10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: horner([1] * 30, 10)')
try: print('horner([1, 1], 10 ** 30) =>', horner([1, 1], 10 ** 30))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: horner([1, 1], 10 ** 30)')
try:
    def cf(n, d):
        out = []
        while d: out.append(n // d); n, d = d, n % d
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def cf(n, d):')
try:
    def convergents(c):
        h0, h1, k0, k1 = 1, c[0], 0, 1; out = [(h1, k1)]
        for a in c[1:]: h0, h1, k0, k1 = h1, a * h1 + h0, k1, a * k1 + k0; out.append((h1, k1))
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def convergents(c):')
try: print('cf(415, 93) =>', cf(415, 93))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cf(415, 93)')
try: print('cf(314159265358979, 10 ** 14) =>', cf(314159265358979, 10 ** 14))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cf(314159265358979, 10 ** 14)')
try: print('convergents(cf(314159265358979, 10 ** 14))[:5] =>', convergents(cf(314159265358979, 10 ** 14))[:5])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: convergents(cf(314159265358979, 10 ** 14))[:5]')
try: print('(0.1).as_integer_ratio() =>', (0.1).as_integer_ratio())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (0.1).as_integer_ratio()')
try: print('cf(*(0.1).as_integer_ratio())[:4] =>', cf(*(0.1).as_integer_ratio())[:4])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: cf(*(0.1).as_integer_ratio())[:4]')
try: print('(3.141592653589793).as_integer_ratio() =>', (3.141592653589793).as_integer_ratio())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: (3.141592653589793).as_integer_ratio()')
