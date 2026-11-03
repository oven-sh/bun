# What a TypeError from a call suggests: a module called in place of what it has under its own name, a keyword that is nearly right.
import types

def t(label, f):
    try:
        print(label, 'ok', f())
    except Exception as e:
        print(label, type(e).__name__, e)

import pprint, json, os
t('pprint', lambda: pprint(1))
t('json', lambda: json('{}'))
t('os', lambda: os())
m = types.ModuleType('mod')
t('empty', lambda: m())
m.mod = 1
t('not callable', lambda: m())
m.mod = lambda: 'called'
t('callable', lambda: m())
t('with arguments', lambda: m(1, a=2))
m.__name__ = 'other'
t('renamed', lambda: m())
m.__name__ = 5
t('no name', lambda: m())
del m.__name__
t('no name', lambda: m())
class Sub(types.ModuleType): pass
s = Sub('sub'); s.sub = len
t('subclass', lambda: s())
g = types.ModuleType('g')
g.__getattr__ = lambda name: (_ for _ in ()).throw(RuntimeError(name))
t('module __getattr__ raises', lambda: g())
t('map', lambda: list(map(m, [1])))
one, none = 1, None
t('int', lambda: one())
t('None', lambda: none())

t('ImportError', lambda: ImportError(namez=1))
t('ImportError', lambda: ImportError(pat=1))
t('ImportError', lambda: ImportError(zzz=1))
t('ImportError', lambda: ImportError('m', name='n', path='p', name_from='f').name_from)
t('min', lambda: min(1, 2, kee=len))
t('max', lambda: max(1, 2, defaul=1))
t('min', lambda: min(1, 2, zzz=1))
t('print', lambda: print(1, sepp=''))
t('print', lambda: print(1, fil=None))
t('sorted', lambda: sorted([], kez=1))
t('sort', lambda: [].sort(revers=1))
t('open', lambda: open('x', modee='r'))
t('int', lambda: int('1', bas=2))
t('enumerate', lambda: enumerate([], strt=1))
t('dict.pop', lambda: {}.pop(1, default=2))
t('str.split', lambda: ''.split(seperator=1))
t('str.encode', lambda: ''.encode(encodin='x'))
t('bytes', lambda: bytes('a', encodin='x'))
t('compile', lambda: compile('1', 'f', 'eval', flag=0))
t('round', lambda: round(1.5, ndigit=1))
t('sum', lambda: sum([], strt=1))
t('pow', lambda: pow(2, 3, modd=5))
t('zip', lambda: zip([], strct=True))
t('map', lambda: map(len, [], strct=True))
t('complex', lambda: complex(rea=1))
t('str', lambda: str(b'', encodin='x'))

# More keywords than there are names for is what is said first.
t('min', lambda: min(0, default=1, key=2, foo=3))
t('max', lambda: max(0, foo=3, bar=4, baz=5))
t('print', lambda: print(0, sep=1, end=2, file=3, flush=4, foo=5))
t('ImportError', lambda: ImportError(0, name=1, path=2, name_from=3, foo=3))
t('NameError', lambda: NameError(a=1, b=2))
t('AttributeError', lambda: AttributeError(name=1, obj=2, c=3))
t('AttributeError', lambda: AttributeError(a=1))
t('sorted', lambda: sorted([], key=1, reverse=2, foo=3))
t('sort', lambda: [].sort(key=1, reverse=2, foo=3))
t('sum', lambda: sum([], start=1, foo=2))
t('int', lambda: int('1', 2, 3))
t('int', lambda: int('1', 2, base=3))
t('int', lambda: int('1', base=2, foo=3))
t('int', lambda: int(base=2, foo=3, bar=4))
t('zip', lambda: zip(strict=1, foo=2))
t('map', lambda: map(len, strict=1, foo=2))
t('str', lambda: str(object=1, encoding=2, errors=3, foo=4))
t('complex', lambda: complex(real=1, imag=2, foo=3))
t('complex', lambda: complex(1, 2, 3))
t('complex', lambda: complex(1, imag=3, foo=1))
