import _tokenize
T = _tokenize.TokenizerIter
def lines(s):
    it = iter(s.splitlines(True))
    return it.__next__
def run(s, **kw):
    kw.setdefault('extra_tokens', True)
    it = T(lines(s) if isinstance(s, str) else s, **kw)
    n = 0
    while True:
        try:
            print('  ', next(it))
        except StopIteration as e:
            print('   Stop', e.args); n += 1
        except BaseException as e:
            print('   ', type(e).__name__, e.args, getattr(e, 'lineno', None), getattr(e, 'offset', None), getattr(e, 'text', None), getattr(e, 'filename', None)); n += 1
        if n >= 1: break
for s in ['', 'a', '(', 'x = \\\n', 'x = 1 + \\\n  2 + \\\n', 'if x:\n    a\n  b\n', 'if x:\n\ta\n        b\n', 'a \\ b\n', '"abc\n', '"""abc\n', '1a\n', '$\n', 'a\x00b\n', 'f"{a\n', "f'{'\n", ')\n', '(]\n', '\\\n', '  \\\n', 'é = (\n']:
    print(repr(s)); run(s)
for a in [(), (1,), (lambda: '',)]:
    try: print(T(*a))
    except Exception as e: print(type(e).__name__, e)
for kw in [dict(extra_tokens=1, encoding=5), dict(extra_tokens=[], encoding='utf-8'), dict(extra_tokens=True, foo=1), dict(extra_tokens=True, encoding='nope'), dict(extra_tokens=True, encoding='a\0b')]:
    try:
        it = T(lambda: b'x', **kw); print(it.__class__, next(it))
    except Exception as e: print(type(e).__name__, e)
run(lambda: 5)
run(lambda: b'x')
run(lambda: 'x', encoding='utf-8')
def bad():
    raise KeyError('k')
run(bad)
st = iter(['a = 1\n', 'b = (\n'])
def bad2():
    try: return next(st)
    except StopIteration: raise KeyError('later')
run(bad2)
print(T.__name__, T.__module__, T.__qualname__, T.__mro__, T.__flags__ & (1 << 10), iter(T(lambda: '', extra_tokens=True)).__class__)
try:
    class S(T): pass
except TypeError as e: print(e)
run('a\udc80\n')
