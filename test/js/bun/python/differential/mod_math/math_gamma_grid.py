# gamma, lgamma, erf, erfc on dense grids: CPython computes the first two itself.
import math

def show(name, x):
    try:
        r = repr(getattr(math, name)(x))
    except Exception as e:
        r = '%s: %s' % (type(e).__name__, e)
    print(name, repr(x), r)

for i in range(-420, 420):
    x = i / 2 + 0.25
    show('gamma', x)
    show('lgamma', x)
for i in range(-30, 180):
    show('gamma', float(i))
    show('lgamma', float(i))
for i in range(1, 60):
    x = 10.0 ** -i
    for y in (x, -x, 1 + x, 1 - x, 2 + x, 2 - x, -1 + x, -1 - x):
        show('gamma', y)
        show('lgamma', y)
for i in range(0, 40):
    x = 10.0 ** (i * 8)  if i * 8 < 308 else 1e308
    show('lgamma', x)
    show('lgamma', -x - 0.5)
for i in range(-70, 70):
    x = i / 10
    show('erf', x)
    show('erfc', x)
for i in range(0, 300, 7):
    show('erfc', i / 10)
