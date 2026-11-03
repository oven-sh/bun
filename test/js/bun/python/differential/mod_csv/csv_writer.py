import csv, _csv, io, decimal, fractions

def show(f, *a, **k):
    try:
        r = f(*a, **k)
        print(repr(r))
    except BaseException as e:
        print(type(e).__name__, e)

def write(row, **k):
    s = io.StringIO(newline='')
    try:
        w = csv.writer(s, **k)
        r = w.writerow(row)
        print(repr(s.getvalue()), r)
    except BaseException as e:
        print(type(e).__name__, e, repr(s.getvalue()))

def writes(rows, **k):
    s = io.StringIO(newline='')
    try:
        w = csv.writer(s, **k)
        r = w.writerows(rows)
        print(repr(s.getvalue()), r)
    except BaseException as e:
        print(type(e).__name__, e, repr(s.getvalue()))

ALLQ = [csv.QUOTE_MINIMAL, csv.QUOTE_ALL, csv.QUOTE_NONNUMERIC, csv.QUOTE_NONE, csv.QUOTE_STRINGS, csv.QUOTE_NOTNULL]
class S(str): pass
class I(int): pass
class O:
    def __str__(self): return 'o,o'
class N:
    def __float__(self): return 1.0
    def __str__(self): return 'N'
class X:
    def __index__(self): return 1
    def __str__(self): return 'X'
class Bad:
    def __str__(self): raise KeyError('bad')

rows = [
    [], [''], [None], ['', ''], [None, None], ['a'], ['a', 'b'], [1, 2.5, True, None, 'x'], ['a,b'], ['a"b'], ['a\nb'], ['a\rb'],
    ['a b'], [' a'], ['a\\b'], [S('s,s')], [I(5)], [O()], [N()], [X()], [1j], [decimal.Decimal('1.5')], [fractions.Fraction(1, 3)],
    [b'bytes'], [[1, 2]], [(1, 2)], ['é', '中', '\U0001f600'], ['a\x00b'], 'abc', ('a', 'b'), {'k': 1, 'j': 2}, iter(['i', 'j']),
    [float('inf'), float('nan'), -0.0, 1e100, 10**30], ['"'], ['""'], ["'"], ['a', ''], ['', 'a'], [None, 'a'], ['a', None],
]
for q in ALLQ:
    print('quoting', q)
    for row in rows:
        if hasattr(row, '__next__'):
            row = iter(['i', 'j'])
        write(row, quoting=q)
    for row in rows:
        if hasattr(row, '__next__'):
            row = iter(['i', 'j'])
        write(row, quoting=q, escapechar='\\')

write(['a"b', 'c'], doublequote=False)
write(['a"b', 'c'], doublequote=False, escapechar='\\')
write(['a"b\\', 'c'], doublequote=False, escapechar='\\')
write(['a"b\\', 'c'], escapechar='\\')
write(['a"b', 'c'], quotechar=None)
write(['a"b', 'c,d'], quotechar=None)
write(['a"b', 'c,d'], quotechar=None, escapechar='\\')
write(['a;b', "c'd"], delimiter=';', quotechar="'")
write(['a', 'b'], lineterminator='\n')
write(['a', 'b'], lineterminator='')
write(['a', 'bXc'], lineterminator='XY')
write(['a', 'bYc'], lineterminator='XY', quoting=csv.QUOTE_NONE)
write(['a', 'bYc'], lineterminator='XY', quoting=csv.QUOTE_NONE, escapechar='\\')
write(['a', 'b'], dialect='unix')
write(['a', 'b'], dialect='excel-tab')
write(['a\tb', 'b'], dialect='excel-tab')
write(['a', 'b'], 'unix') if False else None
write(['', 'a'], delimiter=' ', skipinitialspace=True)
write(['a', ''], delimiter=' ', skipinitialspace=True)
write([None, 'a'], delimiter=' ', skipinitialspace=True)
write(['', 'a'], delimiter=' ', skipinitialspace=True, quoting=csv.QUOTE_NONE)
write([None, 'a'], delimiter=' ', skipinitialspace=True, quoting=csv.QUOTE_STRINGS)
write([None, 'a'], delimiter=' ', skipinitialspace=True, quoting=csv.QUOTE_NOTNULL)
write(['', 'a'], delimiter=' ', skipinitialspace=True, quoting=csv.QUOTE_NOTNULL)
write(['', 'a'], delimiter=' ')
write([' a', 'b '], skipinitialspace=True)
write(['\U0001f600', 'a\U0001f601b'], delimiter='\U0001f601')
write(['\U0001f600', 'a\U0001f601b'], quotechar='\U0001f601')
write(['\U0001f600', 'a\U0001f601b'], quotechar='\U0001f601', doublequote=False, escapechar='\U0001f602')
write([Bad()])
write(1)
write(None)
write(1.5)
write(O())

writes([['a', 'b'], [1, 2], []])
writes([])
writes(iter([['a']]))
writes([['a'], 1])
writes(1)
writes(None)
writes('ab')
writes([['a'], [Bad()], ['c']])

# The file
class W:
    def write(self, s):
        print('write', repr(s))
        return 42
show(csv.writer(W()).writerow, ['a', 'b'])
show(csv.writer(W()).writerows, [['a', 'b'], ['c']])
class W2:
    def write(self, s):
        raise OSError('disk full')
show(csv.writer(W2()).writerow, ['a', 'b'])
show(csv.writer(W2()).writerows, [['a', 'b']])
class W3:
    write = 5
class W4:
    @property
    def write(self):
        raise ZeroDivisionError('prop')
show(csv.writer, W3())
show(csv.writer, W4())
show(csv.writer, None)
show(csv.writer, 1)
show(csv.writer)
show(csv.writer, W(), 'excel', 1)
show(csv.writer, W(), foo=1)
show(csv.writer, W(), 'nope')
show(csv.writer, fileobj=W())
w = csv.writer(W())
print(type(w), type(w.dialect), w.dialect.delimiter)
show(setattr, w, 'dialect', 1)
show(w.writerow)
show(w.writerow, [], [])
show(w.writerows)
show(w.writerow, row=[])
print(sorted(n for n in dir(w) if not n.startswith('__')))
print(sorted(n for n in dir(csv.reader([])) if not n.startswith('__')))
