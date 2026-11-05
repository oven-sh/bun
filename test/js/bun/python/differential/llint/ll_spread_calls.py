# f(*positional, **keywords): what may be after the stars, who is called, and in which order things happen.
import collections
import functools
import re
import types


def shown(value):
    if isinstance(value, dict):
        return '{' + ', '.join('%s%r: %s' % ('' if type(k) is str else type(k).__name__ + ' ', str(k) if isinstance(k, str) else k, shown(v)) for k, v in value.items()) + '}'
    if isinstance(value, tuple):
        return '(' + ', '.join(shown(v) for v in value) + ')'
    return repr(value)


def f0(): return 'f0'
def f1(a): return ('f1', a)
def f2(a, b=2): return ('f2', a, b)
def f3(a, b, c): return ('f3', a, b, c)
def fv(*args): return ('fv', args)
def fk(**kw): return ('fk', kw)
def fvk(*args, **kw): return ('fvk', args, kw)
def favk(a, *args, **kw): return ('favk', a, args, kw)
def fko(a, *, b=2, c): return ('fko', a, b, c)
def fpo(a, b=2, /, c=3): return ('fpo', a, b, c)
def fpok(a, /, **kw): return ('fpok', a, kw)


class Made:
    def __init__(self, a=1, *args, **kw):
        self.state = (a, args, kw)

    def __repr__(self):
        return 'Made' + shown(self.state)

    def method(self, a, b=2, **kw):
        return ('method', a, b, kw)

    @classmethod
    def cm(cls, *args, **kw):
        return ('cm', cls.__name__, args, kw)

    @staticmethod
    def sm(a, b=2):
        return ('sm', a, b)

    def __call__(self, *args, **kw):
        return ('__call__', args, kw)


callees = {
    'f0': f0, 'f1': f1, 'f2': f2, 'f3': f3, 'fv': fv, 'fk': fk, 'fvk': fvk, 'favk': favk, 'fko': fko, 'fpo': fpo, 'fpok': fpok,
    'lambda': lambda a, b=2, *r, **k: ('lambda', a, b, r, k), 'Made': Made, 'method': Made().method, 'cm': Made.cm, 'sm': Made.sm, 'callable object': Made(),
    'partial': functools.partial(favk, 'p', x='from partial'), 'dict': dict, 'int': int, 'sorted': sorted, 'max': max, 'str.format': '{} {a}'.format, 'tuple': tuple,
    'SimpleNamespace': types.SimpleNamespace, 'divmod': divmod, 'len': len, 'not callable': 5,
}


class TupleChild(tuple):
    pass


class TupleOwnIter(tuple):
    def __iter__(self):
        return iter(('from', '__iter__'))


class ListOwnIter(list):
    def __iter__(self):
        return iter(['from', '__iter__'])


class OnlyGetItem:
    def __getitem__(self, i):
        if i > 1:
            raise IndexError
        return 'item%d' % i


class IterRaises:
    def __iter__(self):
        raise KeyError('in __iter__')


class NextRaises:
    def __iter__(self):
        return self

    def __next__(self):
        raise TypeError('in __next__')


def positionals():
    return {
        '()': (), '(1,)': (1,), '(1, 2)': (1, 2), '(1, 2, 3)': (1, 2, 3), '[]': [], '[1, 2]': [1, 2], 'tuple child': TupleChild((1, 2)), 'tuple with __iter__': TupleOwnIter((1, 2, 3)),
        'list with __iter__': ListOwnIter([1]), 'generator': (i for i in (1, 2)), 'dict': {'x': 1, 'y': 2}, 'str': 'ab', 'range': range(2), 'only __getitem__': OnlyGetItem(),
        '5': 5, 'None': None, '__iter__ raises': IterRaises(), '__next__ raises': NextRaises(), 'long': tuple(range(40)),
    }


class DictChild(dict):
    pass


class DictOwnKeys(dict):
    def keys(self):
        return ['a']

    def __getitem__(self, key):
        return 'from __getitem__'


class MappingLike:
    def keys(self):
        return ['a', 'b']

    def __getitem__(self, key):
        return key * 2


class KeysOnly:
    def keys(self):
        return ['a']


class KeysRaises:
    def keys(self):
        raise AttributeError('in keys')


class StrChild(str):
    pass


def made(*parts):
    return ''.join(parts)


def keyword_sources():
    return {
        '{}': {}, "{'a': 1}": {'a': 1}, "{'b': 1}": {'b': 1}, "{'a': 1, 'b': 2}": {'a': 1, 'b': 2}, "{'c': 3, 'a': 1}": {'c': 3, 'a': 1}, "{'zz': 1}": {'zz': 1},
        'names made at run time': {made('a'): 1, made('', 'b'): 2}, 'long names made at run time': {made('some', '_', 'name'): 1, made('a'): 2}, 'dict child': DictChild(a=1),
        'dict with keys()': DictOwnKeys(zz=1), 'mapping': MappingLike(), 'frozendict': frozendict(a=1), 'mappingproxy': types.MappingProxyType({'a': 1}), 'OrderedDict': collections.OrderedDict(b=1, a=2),
        'keys() only': KeysOnly(), 'keys() raises': KeysRaises(), '5': 5, 'None': None, 'list': ['a'], 'a key that is no str': {1: 2}, 'no str among strs': {'a': 1, 2: 3},
        'str child': {StrChild('a'): 1}, 'str children': {StrChild('zz'): 1, 'b': 2}, 'reverse': {'reverse': True}, 'base': {'base': 8}, 'many': {'k%d' % i: i for i in range(30)},
    }


forms = '''
def star(f, p, k): return f(*p)
def stars(f, p, k): return f(**k)
def both(f, p, k): return f(*p, **k)
def one_star(f, p, k): return f(0, *p)
def star_one(f, p, k): return f(*p, 0)
def star_star(f, p, k): return f(*p, *p)
def keyword_stars(f, p, k): return f(a='given', **k)
def stars_keyword(f, p, k): return f(**k, a='given')
def stars_stars(f, p, k): return f(**k, **k)
def everything(f, p, k): return f(0, *p, zz='given', **k)
def method_star(f, p, k): return f.__call__(*p)
def method_both(f, p, k): return f.__call__(*p, **k)
'''
scope = {}
exec(forms, scope)


def attempt(form, f, p, k):
    try:
        return shown(scope[form](f, p, k))
    except Exception as e:
        return type(e).__name__ + ': ' + re.sub(' at 0x[0-9a-f]+', '', str(e))


# To what is written in C, CPython hands the dict as it is, and each says of keys that are no strs what it likes, when it gets to them.
takes_the_dict_as_it_is = ('dict', 'int', 'sorted', 'max', 'str.format', 'tuple', 'SimpleNamespace', 'divmod', 'len', 'not callable', 'partial')


def table(title, form, callee_names, positional_names, keyword_names):
    print('---', title)
    for callee in callee_names:
        lines = {}
        for p in positional_names:
            for k in keyword_names:
                if callee in takes_the_dict_as_it_is and k in ('a key that is no str', 'no str among strs', 'str child', 'str children'):
                    continue
                result = attempt(form, callees[callee], positionals()[p], keyword_sources()[k])
                lines.setdefault(result, []).append((p + ' ' if len(positional_names) > 1 else '') + (k if len(keyword_names) > 1 else ''))
        for result, which in lines.items():
            print(callee, '|', '; '.join(which), '|', result[:300])


every_callee = list(callees)
every_positional = list(positionals())
every_keywords = list(keyword_sources())
table('f(*p)', 'star', every_callee, every_positional, ['{}'])
table('f(**k)', 'stars', every_callee, ['()'], every_keywords)
some_positional = ['()', '(1,)', '(1, 2)', '[1, 2]', 'generator', '5', 'tuple with __iter__']
some_keywords = ['{}', "{'a': 1}", "{'b': 1}", 'names made at run time', 'mapping', '5', 'a key that is no str', 'str child']
table('f(*p, **k)', 'both', every_callee, some_positional, some_keywords)
python_callees = ['f1', 'f2', 'f3', 'fv', 'fvk', 'favk', 'fko', 'fpo', 'fpok', 'Made', 'method', 'partial', 'dict', 'callable object']
for form in ('one_star', 'star_one', 'star_star'):
    table(form, form, python_callees, some_positional, ['{}'])
for form in ('keyword_stars', 'stars_keyword', 'stars_stars'):
    table(form, form, python_callees, ['()'], some_keywords + ["{'zz': 1}", 'dict with keys()'])
table('everything', 'everything', python_callees, ['()', '(1, 2)', 'generator'], ['{}', "{'b': 1}", "{'zz': 1}", 'names made at run time'])
table('f.__call__(*p)', 'method_star', ['f2', 'fv', 'Made', 'callable object', 'len'], some_positional, ['{}'])
table('f.__call__(*p, **k)', 'method_both', ['f2', 'fvk', 'Made', 'callable object', 'dict'], ['()', '(1,)'], some_keywords)

print('--- in which order')
events = []


def note(what, value):
    events.append(what)
    return value


class NotingIterable:
    def __iter__(self):
        events.append('iter')
        yield 1
        events.append('end of iter')


class NotingMapping:
    def keys(self):
        events.append('keys')
        return ['b']

    def __getitem__(self, key):
        events.append('getitem ' + key)
        return 2


for text in ("note('f', f2)(*note('p', NotingIterable()), **note('k', NotingMapping()))", "note('f', fvk)(note('first', 0), *note('p', NotingIterable()), x=note('x', 1), **note('k', NotingMapping()))",
        "note('f', fvk)(*note('p', NotingIterable()), *note('q', NotingIterable()))", "note('f', f2)(*note('p', 5), **note('k', 6))", "note('f', f2)(0, *note('p', 5), **note('k', 6))",
        "note('f', f2)(*note('p', NotingIterable()), **note('k', 6))", "note('f', f2)(*note('p', 5), **note('k', NotingMapping()))", "note('f', 5)(*note('p', NotingIterable()), **note('k', NotingMapping()))"):
    events.clear()
    try:
        result = shown(eval(text))
    except Exception as e:
        result = type(e).__name__ + ': ' + str(e)
    print(text, '|', events, '|', result)

print('--- what is after the stars is not changed, nor shared')
t, l, d = (1, 2), [1, 2], {'x': 1}
got = fvk(*l, **d)
got[2]['y'] = 2
print(l, d, got, got[1] is t, fk(**d)[1] is d, fv(*t)[1] is t, fv(*t)[1] == t)
got = fvk(*l, 3, **d, z=1)
print(l, d, got)


def changes_the_dict(the_dict):
    yield 1
    the_dict['late'] = 'added while the positional ones were gone through'
    the_dict.pop('x', None)


for turn in range(2):
    d = {'x': 1}
    print(fvk(*changes_the_dict(d), **d), d)
    d = {'x': 1}
    print(fvk(0, *changes_the_dict(d), **d), d)

print('--- many names that no parameter has')
for count in (0, 1, 7, 8, 9, 100, 3000):
    names = {made('name', str(i)): i for i in range(count)}
    result = fk(**names)[1]
    print(count, len(result), sum(result.values()), list(result)[:2], result == names, result is names)
    try:
        f2(1, **names)
        print('taken')
    except TypeError as e:
        print(e)

print('--- keys of classes derived from str say themselves what they are equal to')


class Never(str):
    __hash__ = str.__hash__

    def __eq__(self, other):
        return False


class Always(str):
    __hash__ = str.__hash__

    def __eq__(self, other):
        return True


class Telling(str):
    __hash__ = str.__hash__

    def __eq__(self, other):
        events.append((str(self), str(other)))
        return str.__eq__(self, other)


def ab_kw(ab=0, **kw): return ('ab_kw', ab, kw)
def ab_only(ab=0): return ('ab_only', ab)
def posonly(aa=0, /, bb=1): return ('posonly', aa, bb)
def posonly_kw(aa=0, /, bb=1, **kw): return ('posonly_kw', aa, bb, kw)


for cls in (str, StrChild, Never, Always, Telling):
    for text in ('ab', made('a', 'b'), 'aa', made('a', 'a'), 'bb', 'zz', made('z', 'z')):
        for f in (ab_kw, ab_only, posonly, posonly_kw, functools.partial(ab_kw), functools.partial(ab_kw, x=1), dict):
            for positional in ((), (5,)):
                events.clear()
                try:
                    result = shown(f(*positional, **{cls(text): 1}))
                except Exception as e:
                    result = type(e).__name__ + ': ' + str(e)
                print(cls.__name__, text, getattr(f, '__name__', 'partial'), positional, '|', result, events)

stored = functools.partial(fk, **{StrChild('a'): 1})
print(shown(stored()), shown(stored(**{StrChild('b'): 2})), shown(functools.partial(fk, x=1)(**{StrChild('b'): 2})), [type(k).__name__ for k in stored.keywords])
print(shown(functools.partial(stored, **{StrChild('c'): 3})()), [type(k).__name__ for k in functools.partial(stored, **{StrChild('c'): 3}).keywords])



def po2(aa=0, cc=0, /, bb=1): return ('po2', aa, cc, bb)


for keys in ({'qq': 2, Always('zzz'): 1}, {Always('zzz'): 1, 'qq': 2}, {'aa': 1, 'cc': 2}, {StrChild('aa'): 1, 'x': 2}, {'x': 2, Never('aa'): 1}, {made('c', 'c'): 1, 'x': 2}):
    try:
        print(shown(po2(**keys)))
    except TypeError as e:
        print(e)

for taker in (dict, collections.OrderedDict, lambda **kw: vars(types.SimpleNamespace(**kw)), lambda **kw: vars(types.SimpleNamespace(**{StrChild('a'): 1})), lambda **kw: (lambda d: (d.update(**kw), d)[1])({}),
        lambda **kw: (lambda d: (d.update(**kw), d)[1])(collections.OrderedDict()), collections.defaultdict, collections.Counter):
    print(shown(dict(taker(**{StrChild('a'): 1, 'b': 2}))))

print('--- keywords written out, after something that is gone through')
for text in ("fvk(*changes_the_dict(d), a=1)", "fvk(*changes_the_dict(d), a=1, **d)", "fvk(*range(2), a=1)", "fvk(*'ab', a=1, b=2)", "fvk(*{'k': 1}, a=1)", "fvk(*changes_the_dict(d), **d, a=1)", "fvk(*(i for i in (1, 2)), **{})",
        "fvk(*(i for i in (1, 2)), **{'a': 1})", "f2(*range(1), b=5)", "f2(*range(1), a=5)"):
    d = {'x': 1}
    try:
        print(text, '|', shown(eval(text)), d)
    except TypeError as e:
        print(text, '|', e, d)

print('--- the lines that a call over several lines is on')
import sys

several_lines = '''
def c1(f, a, k):
    return f(
        *a,
        **k
    )
def c2(f, a, k):
    return f(
        **k
    )
def c3(f, a, k):
    return f(
        *a
    )
def c4(f, a, k):
    return f(
        0,
        *a,
        **k
    )
def c5(f, a, k):
    return f(
        *a, **k)
def c6(f, a, k):
    return f(*a,
        **k)
def c7(f, a, k):
    return f(*a, **k)
def c8(f, a, k):
    return f(
        *a,
        x=1,
        **k
    )
def c9(f, a, k):
    return f(
        *(a if a else
          a),
        **(k if k else
           k)
    )
def c10(f, a, k):
    return (
        f
    )(
        *a,
        **k
    )
'''
scope = {}
exec(compile(several_lines, 'several_lines', 'exec'), scope)


def lines_of(function, *args):
    seen = []

    def tracer(frame, event, arg):
        if frame.f_code is function.__code__:
            if event == 'line':
                seen.append(frame.f_lineno - function.__code__.co_firstlineno)
            return tracer
    sys.settrace(tracer)
    try:
        function(*args)
    finally:
        sys.settrace(None)
    return seen


for name in sorted(scope, key=lambda n: (len(n), n)):
    if name.startswith('c'):
        function = scope[name]
        first = function.__code__.co_firstlineno
        # (Where the jump out of a conditional expression is, is the compiler's business.)
        print(name, lines_of(function, fvk, (1,), {'y': 2}), lines_of(function, fvk, (), {}), name == 'c9' or [line - first for _, _, line in function.__code__.co_lines() if line is not None])
