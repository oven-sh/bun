# Every way of making an object of the module, again and again, with the results kept and checked afterwards: for runs in which the collector is made to work all the time.
import decimal
from decimal import Decimal, Context, localcontext, getcontext

class Sub(Decimal):
    pass

kept = []
c = Context(prec=50)
for i in range(1, 120):
    a = Decimal(i)
    b = Decimal("%d.%d" % (i, i * 7))
    long = Decimal(str(i) * 40)
    kept.append((i, a + b, a - b, a * b, a / b, a // b, a % b, divmod(b, a), a ** 3, -b, +b, abs(b), b.quantize(Decimal("0.1")), b.sqrt(), long * long, long / 7, long + 1,
                 c.multiply(long, long), c.divide(long, 3), c.sqrt(long), a.fma(b, long), b.as_tuple(), b.as_integer_ratio(), str(long), repr(b), format(b, ",.3f"), hash(b), int(long), float(b),
                 Sub(b), Sub(b) + 1, Decimal((0, (1, i % 10, 3), -2)), Decimal(i / 7), Decimal.from_float(i / 3), c.create_decimal(str(i) * 60), b.copy_negate(), b.max(a), b.normalize(), b.to_integral_value(),
                 b.number_class(), b.compare(a), long.logb(), b.exp(), b.ln(), round(b, 1), round(b), c.copy(), c.flags.copy(), Context(prec=i), repr(c.traps), b.__reduce__(), c.__reduce__()[1][:6]))
    with localcontext(prec=i) as inner:
        kept.append((i, Decimal(1) / 7, inner.prec, getcontext() is inner))
total = 0
for item in kept:
    for value in item:
        total += len(repr(value))
print(len(kept), total)
print(kept[100][1:8])
print(kept[-2][14:21])
print(kept[-1])
