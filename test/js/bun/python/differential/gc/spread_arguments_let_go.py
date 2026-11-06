# f(x, *positional, **keywords): once the arguments are with the callee, the caller holds neither them nor what they came in.
import gc


class Noisy:
    def __init__(self, name):
        self.name = name

    def __del__(self):
        gone.append(self.name)


class NoisyList(list):
    def __del__(self):
        gone.append('the list')


class NoisyTuple(tuple):
    def __del__(self):
        gone.append('the tuple')


class NoisyDict(dict):
    def __del__(self):
        gone.append('the dict')


class NoisyIterable:
    def __init__(self, *names):
        self.names = names

    def __iter__(self):
        for name in self.names:
            yield Noisy(name)

    def __del__(self):
        gone.append('the iterable')


class NoisyMapping:
    def keys(self):
        return ['k']

    def __getitem__(self, name):
        return Noisy('value of ' + name)

    def __del__(self):
        gone.append('the mapping')


gone = []


def report(what):
    gc.collect()
    print(what, sorted(gone))
    gone.clear()


def takes_two(a, b):
    report('  on entry')
    a = None
    report('  a dropped')
    b = None
    report('  b dropped')


def takes_args(*args):
    report('  on entry')
    args = None
    report('  args dropped')


def takes_kw(**kw):
    report('  on entry')
    kw = None
    report('  kw dropped')


def takes_named(*, k):
    report('  on entry')
    k = None
    report('  k dropped')


def takes_all(a, *args, **kw):
    report('  on entry')
    a = None
    report('  a dropped')
    args = None
    report('  args dropped')
    kw = None
    report('  kw dropped')


# (To these CPython passes the tuple and the dict, and holds them until the call is over.)
class Made:
    def __init__(self, a, *args, **kw): pass
    def method(self, a, *args, **kw): pass
    def __call__(self, a, *args, **kw): pass


def generator(a, *args, **kw):
    report('  on entry')
    a = args = kw = None
    report('  all dropped')
    yield


def cases():
    made = Made(0)
    gone.clear()
    for turn in range(2):
        print('a list made for the call')
        takes_two(*[Noisy('a'), Noisy('b')])
        takes_args(*[Noisy('a'), Noisy('b')])
        print('a tuple made for the call')
        takes_two(*(Noisy('a'), Noisy('b')))
        takes_args(*(Noisy('a'), Noisy('b')))
        print('lists and tuples that say when they go')
        takes_two(*NoisyList([Noisy('a'), Noisy('b')]))
        takes_two(*NoisyTuple([Noisy('a'), Noisy('b')]))
        takes_args(*NoisyList([Noisy('a'), Noisy('b')]))
        takes_args(*NoisyTuple([Noisy('a'), Noisy('b')]))
        print('an iterable')
        takes_two(*NoisyIterable('a', 'b'))
        takes_args(*NoisyIterable('a', 'b'))
        takes_two(Noisy('a'), *NoisyIterable('b'))
        print('one before the star')
        takes_two(Noisy('a'), *[Noisy('b')])
        takes_two(Noisy('a'), *(Noisy('b'),))
        takes_args(Noisy('a'), *(Noisy('b'),))
        takes_two(Noisy('a'), Noisy('b'), *())
        print('dicts')
        takes_kw(**{'k': Noisy('k')})
        takes_named(**{'k': Noisy('k')})
        takes_kw(**NoisyDict(k=Noisy('k')))
        takes_named(**NoisyDict(k=Noisy('k')))
        takes_kw(**NoisyMapping())
        takes_named(**NoisyMapping())
        takes_kw(**NoisyDict())
        takes_kw(k=Noisy('k'), **{'l': Noisy('l')})
        takes_kw(**{'k': Noisy('k')}, **{'l': Noisy('l')})
        print('everything')
        takes_all(Noisy('a'), *[Noisy('b')], **{'k': Noisy('k')})
        takes_all(*[Noisy('a'), Noisy('b')], **{'k': Noisy('k')})
        takes_all(*NoisyIterable('a', 'b'), **NoisyMapping())
        takes_all(Noisy('a'), *NoisyIterable('b'), k=Noisy('k'), **NoisyMapping() if turn > 5 else {})
        takes_all(*[Noisy('a')], *[Noisy('b')], **NoisyDict())
        takes_all(*[Noisy('a')], Noisy('b'))
        print('who is called')
        Made(*[Noisy('a'), Noisy('b')], **{'k': Noisy('k')})
        report('  a class')
        made.method(*[Noisy('a'), Noisy('b')], **{'k': Noisy('k')})
        report('  a method')
        made.method(Noisy('a'), *(Noisy('b'),))
        report('  a method')
        made(*[Noisy('a'), Noisy('b')], **{'k': Noisy('k')})
        report('  an object')
        made(Noisy('a'), *NoisyIterable('b'))
        report('  an object')
        bound = made.method
        bound(*[Noisy('a'), Noisy('b')], **{'k': Noisy('k')})
        report('  a bound method')
        for _ in generator(*[Noisy('a'), Noisy('b')]):
            pass
        for _ in generator(Noisy('a'), *NoisyIterable('b')):
            pass
        print('after the call')
        len(*[NoisyList()])
        report('  len')
        print(*(), **NoisyDict(end=''))
        report('  print')
        id(*NoisyIterable('a'))
        report('  id')
        isinstance(Noisy('a'), *(Noisy,))
        report('  isinstance')
        print('a call that fails')
        for attempt in (lambda: takes_two(*[Noisy('a')]), lambda: takes_two(Noisy('a'), *NoisyIterable('b', 'c')), lambda: takes_named(**{'k': Noisy('k'), 'l': Noisy('l')}),
                lambda: takes_kw(*[Noisy('a')]), lambda: len(*[Noisy('a')]), lambda: takes_kw(**{1: Noisy('k')}), lambda: None(*[Noisy('a')], **NoisyDict(k=Noisy('k'))),
                lambda: takes_args(*NoisyIterable('a'), **5), lambda: takes_args(Noisy('a'), *5), lambda: takes_kw(k=Noisy('k'), **NoisyDict(k=Noisy('other')))):
            try:
                attempt()
            except TypeError as e:
                message = str(e)
            report('  ' + message)


cases()
