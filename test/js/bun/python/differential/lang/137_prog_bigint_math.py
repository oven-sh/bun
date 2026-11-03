# Number crunching with arbitrary-precision integers and floats.
def fact(n):
    r = 1
    for i in range(2, n + 1): r *= i
    return r
def fib(n):
    a, b = 0, 1
    for _ in range(n): a, b = b, a + b
    return a
def fib_fast(n):
    if n == 0: return (0, 1)
    a, b = fib_fast(n >> 1); c = a * (2 * b - a); d = a * a + b * b
    return (d, c + d) if n & 1 else (c, d)
def binom(n, k):
    r = 1
    for i in range(min(k, n - k)): r = r * (n - i) // (i + 1)
    return r
print(fact(25), fact(100), len(str(fact(300))), sum(map(int, str(fact(100)))), fact(50) // fact(48), str(fact(200)).count("0"), len(str(fact(200))) - len(str(fact(200)).rstrip("0")))
print(fib(100), fib(300), fib_fast(1000)[0] % 10 ** 20, len(str(fib_fast(2000)[0])), fib(90) == fib_fast(90)[0], next(i for i in range(1, 500) if len(str(fib(i))) >= 50))
print(binom(10, 3), binom(100, 50), binom(200, 100) % 10 ** 9, sum(binom(30, k) for k in range(31)) == 2 ** 30, [binom(8, k) for k in range(9)])
print(2 ** 200, 3 ** 150, 7 ** 77 % 10 ** 10, (2 ** 127 - 1), (10 ** 50 + 1) * (10 ** 50 - 1), (10 ** 40) // 7, (10 ** 40) % 7, -(10 ** 40) // 7, -(10 ** 40) % 7, divmod(10 ** 30, -(10 ** 15 + 3)), 2 ** 100 >> 90, 1 << 130, (1 << 130) - 1 & (1 << 65) - 1, (2 ** 70) ^ (2 ** 69 + 12345), ~(2 ** 80), (2 ** 64 - 1).bit_length(), (2 ** 64).bit_length(), bin(2 ** 70 + 5).count("1"), (123456789 ** 5).bit_count())
def isqrt(n):
    if n < 2: return n
    x = 1 << (n.bit_length() + 1) // 2
    while True:
        y = (x + n // x) // 2
        if y >= x: return x
        x = y
def iroot(n, k):
    lo, hi = 0, 1 << (n.bit_length() // k + 1)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if mid ** k <= n: lo = mid
        else: hi = mid - 1
    return lo
print(isqrt(10 ** 40), isqrt(2 * 10 ** 60), isqrt(10 ** 40 - 1), isqrt(99), isqrt(2 ** 200 + 1) == 2 ** 100, iroot(10 ** 30, 3), iroot(2 ** 100, 7), iroot(10 ** 50, 5), [isqrt(n) for n in range(17)])
def pi_digits(n):
    "Gibbons' unbounded spigot."
    q, r, t, k, m, x = 1, 0, 1, 1, 3, 3; out = []
    while len(out) < n:
        if 4 * q + r - t < m * t: out.append(m); q, r, m = 10 * q, 10 * (r - m * t), (10 * (3 * q + r)) // t - 10 * m
        else: q, r, t, k, m, x = q * k, (2 * q + r) * x, t * x, k + 1, (q * (7 * k + 2) + r * x) // (t * x), x + 2
    return "".join(map(str, out))
def e_digits(n):
    scale = 10 ** (n + 10); term = scale; total = 0; k = 0
    while term: total += term; k += 1; term //= k
    return str(total)[:n]
def machin_pi(n):
    scale = 10 ** (n + 10)
    def arctan_inv(x):
        total = term = scale // x; x2 = x * x; k = 1; sign = -1
        while term: term //= x2; k += 2; total += sign * (term // k); sign = -sign
        return total
    return str(4 * (4 * arctan_inv(5) - arctan_inv(239)))[:n]
print(pi_digits(60)); print(machin_pi(100)); print(e_digits(100)); print(str(isqrt(2 * 10 ** 200))[:100]); print(pi_digits(40) == machin_pi(40))
def modpow(b, e, m):
    r = 1; b %= m
    while e:
        if e & 1: r = r * b % m
        b = b * b % m; e >>= 1
    return r
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
def inverse(a, m):
    g, x, y = m, 0, 1; a %= m
    while a: q = g // a; g, a = a, g - q * a; x, y = y, x - q * y
    if g != 1: raise ValueError("not invertible")
    return x % m
print(modpow(2, 1000, 10 ** 9 + 7) == pow(2, 1000, 10 ** 9 + 7), modpow(3, 10 ** 30, 10 ** 18 + 9), [n for n in range(100, 150) if miller_rabin(n)], [miller_rabin(n) for n in (2 ** 61 - 1, 2 ** 89 - 1, 2 ** 67 - 1, 561, 41041, 10 ** 18 + 9, 10 ** 18 + 11, 2 ** 127 - 1, 3215031751)], inverse(3, 11), inverse(10 ** 9, 10 ** 9 + 7), inverse(17, 3120) == pow(17, -1, 3120))
p, q = 2 ** 61 - 1, 2 ** 89 - 1; n = p * q; phi = (p - 1) * (q - 1); e = 65537; d = inverse(e, phi); msg = int.from_bytes(b"attack at dawn", "big"); c = pow(msg, e, n); print(n, c, pow(c, d, n).to_bytes(14, "big"))
def pollard(n):
    x = y = 2; d = 1
    def gcd(a, b):
        while b: a, b = b, a % b
        return a
    while d == 1: x = (x * x + 1) % n; y = (y * y + 1) % n; y = (y * y + 1) % n; d = gcd(abs(x - y), n)
    return d
print(pollard(8051), pollard(10403), sorted((pollard(1000003 * 1000033), 1000003 * 1000033 // pollard(1000003 * 1000033))))
def crt(rs, ms):
    x, m = 0, 1
    for r, mod in zip(rs, ms): x += m * ((r - x) * inverse(m, mod) % mod); m *= mod
    return x, m
print(crt([2, 3, 2], [3, 5, 7]), crt([1, 2, 3, 4], [10 ** 9 + 7, 10 ** 9 + 9, 998244353, 2 ** 31 - 1]))
def to_frac(digits, rep=""):
    "0.digits(rep) as a reduced fraction."
    a = int(digits + rep or "0") - (int(digits or "0") if rep else 0); b = (10 ** len(rep) - 1 if rep else 1) * 10 ** len(digits)
    x, y = a, b
    while y: x, y = y, x % y
    return a // x, b // x
def period(d):
    seen = {}; r = 1; i = 0; out = ""
    while r and r not in seen: seen[r] = i; r *= 10; out += str(r // d); r %= d; i += 1
    return (out, "") if not r else (out[:seen[r]], out[seen[r]:])
print(to_frac("25"), to_frac("", "3"), to_frac("1", "6"), to_frac("", "142857"), [period(d) for d in (2, 3, 6, 7, 8, 12, 13, 17)], max(range(2, 100), key=lambda d: len(period(d)[1])))
def harmonic(n):
    a, b = 0, 1
    for k in range(1, n + 1): a, b = a * k + b, b * k
    x, y = a, b
    while y: x, y = y, x % y
    return a // x, b // x
h = harmonic(40); print(h, h[0] / h[1], len(str(harmonic(100)[0])))
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
print([bernoulli(n) for n in (0, 1, 2, 4, 6, 10, 12, 20)])
def partitions(n):
    p = [1] + [0] * n
    for k in range(1, n + 1):
        for i in range(k, n + 1): p[i] += p[i - k]
    return p[n]
def catalan(n): return binom(2 * n, n) // (n + 1)
def derange(n): return 1 if n == 0 else 0 if n == 1 else (n - 1) * (derange(n - 1) + derange(n - 2))
def stirling2(n, k): return int(n == k) if n == 0 or k == 0 else k * stirling2(n - 1, k) + stirling2(n - 1, k - 1)
print(partitions(100), partitions(200), [catalan(n) for n in range(10)], catalan(50), [derange(n) for n in range(9)], [stirling2(6, k) for k in range(7)], sum(stirling2(8, k) for k in range(9)))
print(sum(int(c) for c in str(2 ** 1000)), len(str(2 ** 1000)), str(2 ** 1000)[:20], int(str(2 ** 200)[::-1]), int("9" * 50) + 1, int("1" * 40) * 9 + 1, 10 ** 100 // 3 * 3 + 1 == 10 ** 100, 111111111 ** 2, 12345679 * 81, (10 ** 18 + 1) ** 3)
# int <-> float at the edges of precision.
print(float(2 ** 53), float(2 ** 53 + 1), float(2 ** 53 + 2), float(2 ** 53 + 3), int(1e22), int(1e23), int(2.5e15), 2 ** 53 + 1 == float(2 ** 53 + 1), 2 ** 53 == float(2 ** 53), 10 ** 22 == 1e22, 10 ** 23 == 1e23, 10 ** 23 > 1e23, 2 ** 1023 * 2 > 1.7e308, float(10 ** 308), 10 ** 400 > float("inf"), -(10 ** 400) < float("-inf"), 10 ** 400 > 1e308, (2 ** 64) / 3, (10 ** 30) / (10 ** 10), (10 ** 400) / (10 ** 399), (2 ** 2000) / (2 ** 1999 + 1), 1 / 3 ** 50, (10 ** 25 + 1) / 10 ** 25, 7 ** 400 // 7 ** 398, (3 ** 100) / (2 ** 100), round(10 ** 20 / 3), int(10 ** 20 / 3), 10 ** 20 // 3)
for f in (lambda: float(10 ** 400), lambda: 10 ** 400 / 3, lambda: 10 ** 400 * 1.0, lambda: 1.5 + 10 ** 400, lambda: 2.0 ** 10000, lambda: int(float("inf")), lambda: 10 ** 400 // 0, lambda: 3 ** 10 ** 2 % 0, lambda: (10 ** 400) ** 0.5, lambda: 1 << -1, lambda: 1 >> -1):
    try: print(f())
    except Exception as e: print(type(e).__name__ + ":", e)
# Floating-point algorithms.
def sqrt(x, eps=1e-15):
    g = x or 1.0
    while abs(g * g - x) > eps * x: g = (g + x / g) / 2
    return g
def exp(x):
    term = total = 1.0; n = 0
    while abs(term) > 1e-17 * abs(total): n += 1; term *= x / n; total += term
    return total
def ln(x):
    y = (x - 1) / (x + 1); y2 = y * y; term = y; total = 0.0; k = 1
    while abs(term / k) > 1e-17: total += term / k; term *= y2; k += 2
    return 2 * total
def sin(x):
    term = total = x; n = 1
    while abs(term) > 1e-17: term *= -x * x / ((n + 1) * (n + 2)); total += term; n += 2
    return total
def bisect(f, lo, hi):
    for _ in range(60):
        mid = (lo + hi) / 2
        if (f(lo) < 0) == (f(mid) < 0): lo = mid
        else: hi = mid
    return lo
def newton(f, df, x):
    for _ in range(50):
        step = f(x) / df(x); x -= step
        if abs(step) < 1e-14: break
    return x
def simpson(f, a, b, n=100):
    h = (b - a) / n
    return h / 3 * (f(a) + f(b) + 4 * sum(f(a + i * h) for i in range(1, n, 2)) + 2 * sum(f(a + i * h) for i in range(2, n, 2)))
print(sqrt(2), sqrt(1e10), sqrt(0.25), exp(1), exp(-1), exp(10), ln(2), ln(10), sin(1), sin(3.141592653589793), bisect(lambda x: x * x - 2, 0, 2), newton(lambda x: x ** 3 - x - 2, lambda x: 3 * x * x - 1, 1.5), simpson(lambda x: x * x, 0, 3), simpson(sin, 0, 3.141592653589793))
def kahan(xs):
    s = c = 0.0
    for x in xs: y = x - c; t = s + y; c = (t - s) - y; s = t
    return s
xs = [0.1] * 1000; naive = 0.0
for x in xs: naive += x
print(naive, kahan(xs), sum(xs), naive == 100.0, kahan(xs) == 100.0)
def mean(a): return sum(a) / len(a)
def var(a): m = mean(a); return sum((x - m) ** 2 for x in a) / (len(a) - 1)
def median(a): s = sorted(a); n = len(s); return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
sample = [(i * 7919 % 101) / 7 for i in range(50)]; print(mean(sample), var(sample), var(sample) ** 0.5, median(sample), min(sample), max(sample), round(mean(sample), 3), "%.6f %.3e %g" % (mean(sample), var(sample), median(sample)))
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
print([round(v, 10) for v in solve([[2.0, 1.0, -1.0], [-3.0, -1.0, 2.0], [-2.0, 1.0, 2.0]], [8.0, -11.0, -3.0])], [round(v, 8) for v in solve([[4.0, -2.0, 1.0], [-2.0, 4.0, -2.0], [1.0, -2.0, 4.0]], [11.0, -16.0, 17.0])])
def horner(cs, x):
    r = 0
    for c in cs: r = r * x + c
    return r
print(horner([1, -3, 0, 2], 4), horner([1, 0, -1], 1.5), horner([2, 0, 1], 1j), horner([1] * 30, 10), horner([1, 1], 10 ** 30))
def cf(n, d):
    out = []
    while d: out.append(n // d); n, d = d, n % d
    return out
def convergents(c):
    h0, h1, k0, k1 = 1, c[0], 0, 1; out = [(h1, k1)]
    for a in c[1:]: h0, h1, k0, k1 = h1, a * h1 + h0, k1, a * k1 + k0; out.append((h1, k1))
    return out
print(cf(415, 93), cf(314159265358979, 10 ** 14), convergents(cf(314159265358979, 10 ** 14))[:5], (0.1).as_integer_ratio(), cf(*(0.1).as_integer_ratio())[:4], (3.141592653589793).as_integer_ratio())
