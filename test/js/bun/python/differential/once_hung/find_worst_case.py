# test_str.StrTest.test_adaptive_find (also test_userstring): not a hang, but O(n*m) where CPython's str.find() and str.count() are O(n+m)
for N in 1000, 10_000, 100_000:
    A, B = 'a' * N, 'b' * N
    haystack = A + A + B + A + A
    needle = A + B + B + A
    for name, f in ("find", lambda: haystack.find(needle)), ("count", lambda: haystack.count(needle)), ("find at the end", lambda: (haystack + needle).find(needle)), ("count at the end", lambda: (haystack + needle).count(needle)):
        print(N, name, f())
