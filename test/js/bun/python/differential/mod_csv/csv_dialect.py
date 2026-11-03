import csv, _csv, io, copy, pickle

def show(f, *a, **k):
    try:
        r = f(*a, **k)
        print(repr(r))
    except BaseException as e:
        print(type(e).__name__, e)

def attrs(d):
    return (d.delimiter, d.doublequote, d.escapechar, d.lineterminator, d.quotechar, d.quoting, d.skipinitialspace, d.strict)

def D(*a, **k):
    try:
        print(attrs(_csv.Dialect(*a, **k)))
    except BaseException as e:
        print(type(e).__name__, e)

D()
D(None)
D('excel')
D('excel-tab')
D('unix')
D('nope')
D(csv.excel)
D(csv.excel())
D(csv.unix_dialect)
D(1)
D(object())
D(delimiter=';')
D(None, ';')
D(None, ';', False, '\\', '\n', "'", 1, True, True)
D(None, ';', False, '\\', '\n', "'", 1, True, True, 1)
D(*range(10))
D(**{k: 1 for k in 'abcdefghij'})
D(foo=1)
D(None, ',', delimiter=';')
D(dialect='unix', delimiter=';')
D('unix', quoting=0)

for name in ('delimiter', 'escapechar', 'quotechar'):
    for v in ('', 'ab', 'abc', None, 1, b'x', 1.5, [], '\n', '\r', ' ', '\t', '\x00', 'é', '\U0001f600', ',', '"', '\\'):
        print(name, repr(v), end=' ')
        D(**{name: v})
        print(name, repr(v), 'skip', end=' ')
        D(**{name: v, 'skipinitialspace': True})
for v in ('', 'ab', None, 1, b'x', '\n', '\r\n', ',', '"', 'x,y', 'x"y', '\U0001f600'):
    print('lineterminator', repr(v), end=' ')
    D(lineterminator=v)
for v in (0, 1, 2, 3, 4, 5, 6, -1, 100, None, '1', 1.0, True, False, 2**31, 2**40, 2**70, -2**31 - 1):
    print('quoting', repr(v), end=' ')
    D(quoting=v)
for name in ('doublequote', 'skipinitialspace', 'strict'):
    for v in (0, 1, None, '', 'x', [], [0], 2.5):
        print(name, repr(v), end=' ')
        D(**{name: v})
class BadBool:
    def __bool__(self): raise ValueError('no truth')
D(strict=BadBool())
D(doublequote=BadBool())

D(quotechar=None)
D(quotechar=None, quoting=csv.QUOTE_NONE)
D(quotechar=None, quoting=csv.QUOTE_ALL)
D(quotechar=None, quoting=csv.QUOTE_MINIMAL)
D(delimiter='x', escapechar='x')
D(delimiter='x', quotechar='x')
D(escapechar='x', quotechar='x')
D(delimiter='x', lineterminator='axb')
D(escapechar='x', lineterminator='axb')
D(quotechar='x', lineterminator='axb')
D(escapechar=None, quotechar=None)
D(delimiter=' ', skipinitialspace=True)
D(escapechar=' ')
D(quotechar=' ')

# From a class, from an object
class C:
    delimiter = ';'
    quotechar = "'"
    strict = 1
D(C)
D(C())
D(C, delimiter='|')
class C2:
    delimiter = 5
D(C2)
class C3:
    @property
    def delimiter(self): raise KeyError('prop')
D(C3())
class C4:
    quoting = 'x'
D(C4)
class C5:
    lineterminator = 4
D(C5)

# The same object comes back
d = _csv.Dialect('excel')
print(_csv.Dialect(d) is d, _csv.Dialect(d, delimiter=';') is d, csv.get_dialect('excel') is d)
class Sub(_csv.Dialect): pass
s = Sub()
print(type(s), attrs(s), _csv.Dialect(s) is s, type(Sub(d)), Sub(d) is d)
s.extra = 1
print(s.extra)
show(setattr, d, 'extra', 1)
for n in ('delimiter', 'doublequote', 'escapechar', 'lineterminator', 'quotechar', 'quoting', 'skipinitialspace', 'strict'):
    show(setattr, d, n, 1)
    show(delattr, d, n)
    print(type(_csv.Dialect.__dict__[n]).__name__)
show(d.__reduce__)
show(d.__reduce_ex__, 2)
show(s.__reduce__)
show(copy.copy, d)
show(copy.deepcopy, d)
show(pickle.dumps, d)
show(setattr, _csv.Dialect, 'x', 1)
print(_csv.Dialect.__doc__)
print(_csv.Dialect.__name__, _csv.Dialect.__qualname__, _csv.Dialect.__module__, _csv.Dialect.__bases__)
print(_csv.Reader.__name__, _csv.Reader.__qualname__, _csv.Reader.__module__, _csv.Writer.__name__)
ls = 'ab'
class LS(str): pass
l = LS('\n')
print(_csv.Dialect(lineterminator=l).lineterminator is l)

# The registry
print(csv.list_dialects(), sorted(_csv._dialects), type(_csv._dialects))
show(csv.register_dialect)
show(csv.register_dialect, 1)
show(csv.register_dialect, None)
show(csv.register_dialect, b'x')
show(csv.register_dialect, 'x', 'excel', 3)
show(csv.register_dialect, 'x', 'nope')
show(csv.register_dialect, 'x', foo=1)
show(csv.register_dialect, 'x', delimiter='ab')
show(csv.register_dialect, name='x')
print(csv.list_dialects())
show(csv.register_dialect, 'mine', delimiter='|', quoting=csv.QUOTE_ALL)
show(csv.register_dialect, 'mine2', 'mine', strict=True)
show(csv.register_dialect, 'mine3', C)
show(csv.register_dialect, 'mine4')
print(csv.list_dialects())
for n in ('mine', 'mine2', 'mine3', 'mine4'):
    print(n, attrs(csv.get_dialect(n)))
print(list(csv.reader(['a|b'], 'mine')), list(csv.reader(['a|b'], dialect='mine2')))
show(csv.get_dialect)
show(csv.get_dialect, 'nope')
show(csv.get_dialect, 1)
show(csv.get_dialect, None)
show(csv.get_dialect, [])
show(lambda: type(csv.get_dialect(name='mine')))
show(csv.get_dialect, 'a', 'b')
show(csv.unregister_dialect)
show(csv.unregister_dialect, 'nope')
show(csv.unregister_dialect, 1)
show(csv.unregister_dialect, [])
show(csv.unregister_dialect, name='mine')
show(csv.unregister_dialect, 'mine')
for n in ('mine2', 'mine3', 'mine4'):
    csv.unregister_dialect(n)
print(csv.list_dialects())
show(csv.list_dialects, 1)
class SN(str): pass
csv.register_dialect(SN('sub'))
print(csv.list_dialects(), type(csv.list_dialects()[-1]))
csv.unregister_dialect('sub')

# csv.Dialect validation goes through _csv.Dialect
class MyD(csv.Dialect):
    delimiter = ','
    quotechar = '"'
    lineterminator = '\n'
    quoting = csv.QUOTE_MINIMAL
    doublequote = True
    skipinitialspace = False
show(lambda: attrs(MyD()))
class MyBad(csv.Dialect):
    delimiter = 'ab'
show(MyBad)
class MyBad2(csv.Dialect):
    pass
show(MyBad2)

# DictReader, DictWriter, Sniffer
f = io.StringIO('a,b,c\r\n1,2,3\r\n4,5\r\n6,7,8,9\r\n')
for row in csv.DictReader(f):
    print(row)
o = io.StringIO()
w = csv.DictWriter(o, ['a', 'b'], restval='-', extrasaction='ignore')
w.writeheader()
w.writerow({'a': 1, 'z': 3})
w.writerows([{'a': 1, 'b': 2}, {'b': 'x,y'}])
print(repr(o.getvalue()))
sn = csv.Sniffer()
dd = sn.sniff('a;b;c\n1;2;3\n4;5;6\n')
print(dd.delimiter, dd.quotechar, dd.doublequote, dd.skipinitialspace)
print(sn.has_header('name,age\nbob,3\nal,4\n'))
