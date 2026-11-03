import csv, _csv, io

def show(f, *a, **k):
    try:
        r = f(*a, **k)
        print(repr(r))
    except BaseException as e:
        print(type(e).__name__, e)

print(sorted(n for n in dir(_csv) if not n.startswith('__')))
print(_csv.__doc__)
print(_csv.QUOTE_MINIMAL, _csv.QUOTE_ALL, _csv.QUOTE_NONNUMERIC, _csv.QUOTE_NONE, _csv.QUOTE_STRINGS, _csv.QUOTE_NOTNULL)
print(_csv.Error, _csv.Error.__mro__, _csv.Error.__module__)
print(_csv.Dialect, _csv.Reader, _csv.Writer)
print(csv.list_dialects())

# Reading
def read(text, **k):
    try:
        print(list(csv.reader(io.StringIO(text, newline=''), **k)))
    except BaseException as e:
        print(type(e).__name__, e)

def readl(lines, **k):
    try:
        print(list(csv.reader(lines, **k)))
    except BaseException as e:
        print(type(e).__name__, e)

read('a,b,c\r\n1,2,3\r\n')
read('a,b,c\n1,2,3')
read('')
read('\n')
read('\r\n\r\n')
read('a,,c\n,,\n')
read('"a,b",c\n')
read('"a""b",c\n')
read('"a\nb",c\nd\n')
read('"a\r\nb",c\r\nd\r\n')
read('a"b,c\n')
read('"a"b,c\n')
read('"a"b,c\n', strict=True)
read('"a" ,c\n', strict=True)
read('"abc', strict=True)
read('"abc')
read('"abc\n')
read('abc\\', escapechar='\\')
read('abc\\', escapechar='\\', strict=True)
read('a\\,b,c\n', escapechar='\\')
read('a\\\nb,c\n', escapechar='\\')
read('a\\\r\nb,c\n', escapechar='\\')
read('"a\\"b",c\n', escapechar='\\')
read('"a\\\nb",c\n', escapechar='\\')
read('"a\\', escapechar='\\')
read(' a, b, "c"\n')
read(' a, b, "c"\n', skipinitialspace=True)
read('a;b;c\n', delimiter=';')
read("'a;b';c\n", delimiter=';', quotechar="'")
read('a\tb\tc\n', dialect='excel-tab')
read('a,b\n', dialect='unix')
read('"a","b"\n', dialect=csv.unix_dialect)
read('a,"b",1,1.5,\n', quoting=csv.QUOTE_NONNUMERIC)
read('1,"b",2e3,-4\n', quoting=csv.QUOTE_NONNUMERIC)
read('1,"b",,""\n', quoting=csv.QUOTE_NONNUMERIC)
read('1,"b",,""\n', quoting=csv.QUOTE_STRINGS)
read('x,"b",,""\n', quoting=csv.QUOTE_STRINGS)
read('1,"b",,""\n', quoting=csv.QUOTE_NOTNULL)
read('1,"b",,""\n', quoting=csv.QUOTE_NONE)
read('1,"b",,""\n', quoting=csv.QUOTE_ALL)
read('a,b\rc,d\r')
readl(['a,b\rc,d'])
readl(['a,b\r\nc,d'])
readl(['a,b\n', 'c,d\r'])
readl(['a,b\n\n'])
readl(['a,b\n\nx'])
readl(['a,b', '', 'c'])
readl([b'a,b'])
readl([1])
readl([None])
readl(['a', ['b']])
readl(['é,中文,\U0001f600x'])
readl(['\U0001f600a\U0001f600b'], delimiter='\U0001f600')
readl(['a\x00b,c'])
readl(['"a""b""",""""'])
readl(['"a""b"'], doublequote=False)
readl(['"a"b"'], doublequote=False)
readl(['"a\\"b"'], doublequote=False, escapechar='\\')
readl(['a,b', 'c,d'], lineterminator='x')
readl(['  a  ,  b  '], skipinitialspace=True)
readl(['a, "b, c"'], skipinitialspace=True)
readl(['a, "b, c"'])
readl(['a b  c'], delimiter=' ')
readl(['a b  c'], delimiter=' ', skipinitialspace=True)

# line_num, dialect
r = csv.reader(['a,b', '"c', 'd",e', 'f'])
print(r.line_num, type(r), type(r.dialect))
for row in r:
    print(r.line_num, row)
show(next, r)
print(iter(r) is r)
show(setattr, r, 'line_num', 3)
show(setattr, r, 'dialect', 3)
show(setattr, r, 'foo', 3)
print(r.dialect.delimiter, r.dialect.quotechar, r.dialect.escapechar, repr(r.dialect.lineterminator), r.dialect.quoting, r.dialect.doublequote, r.dialect.skipinitialspace, r.dialect.strict)

# field size limit
old = csv.field_size_limit()
print(old)
print(csv.field_size_limit(10), csv.field_size_limit())
readl(['a' * 10 + ',b'])
readl(['a' * 11 + ',b'])
readl(['"' + 'a' * 11 + '",b'])
readl(['\U0001f600' * 10])
readl(['\U0001f600' * 11])
print(csv.field_size_limit(0))
readl(['a'])
readl([','])
print(csv.field_size_limit(-5))
readl(['a'])
print(csv.field_size_limit(new_limit=old))
show(csv.field_size_limit, 1.5)
show(csv.field_size_limit, True)
show(csv.field_size_limit, None)
show(csv.field_size_limit, '1')
show(csv.field_size_limit, 2**70)
show(csv.field_size_limit, -2**70)
show(csv.field_size_limit, 1, 2)
print(csv.field_size_limit(2**62), csv.field_size_limit(old))
print(csv.field_size_limit())

# Errors in the arguments
show(csv.reader)
show(csv.reader, [], 'excel', 3)
show(csv.reader, 1)
show(csv.reader, None)
show(csv.reader, [], foo=1)
show(csv.reader, [], 'nope')
show(csv.reader, [], dialect='nope')
show(csv.reader, [], 'excel', dialect='excel')
show(csv.reader, [], delimiter='ab')
show(csv.reader, [], delimiter='')
show(csv.reader, [], delimiter=None)
show(csv.reader, [], delimiter=1)
show(csv.reader, [], delimiter=b',')
show(csv.reader, iterable=[])
show(_csv.Reader)
show(_csv.Writer)
show(_csv.Reader, [])

# An iterator that raises; a generator
def gen():
    yield 'a,b'
    yield '"c'
    raise ValueError('boom')
r = csv.reader(gen())
show(next, r)
show(next, r)
show(next, r)

# A reader advanced from inside its own input
class Evil:
    def __init__(self):
        self.n = 0
    def __iter__(self):
        return self
    def __next__(self):
        self.n += 1
        if self.n == 1:
            return 'a,"b'
        if self.n == 2:
            try:
                print('inner', next(self.reader))
            except BaseException as e:
                print('inner', type(e).__name__, e)
            return 'c",d'
        if self.n < 6:
            return 'x%d' % self.n
        raise StopIteration
e = Evil()
e.reader = csv.reader(e)
for i in range(5):
    show(next, e.reader)
