# What a call passes beyond the parameters lives as long as the tuple or the dict it went to, not as long as the call.
import gc


class Noisy:
    def __init__(self, name):
        self.name = name

    def __del__(self):
        gone.append(self.name)


gone = []


def report(what):
    gc.collect()
    print(what, sorted(gone))
    gone.clear()


def only_kw(**kw):
    kw = None
    report('only_kw: kw dropped')


def only_args(*args):
    args = None
    report('only_args: args dropped')


def both(a, *args, **kw):
    args = None
    report('both: args dropped')
    kw = None
    report('both: kw dropped')


def named(a, b=None, *, c=None, **kw):
    kw = None
    report('named: kw dropped')
    c = None
    report('named: c dropped')
    b = None
    report('named: b dropped')


def popped(**kw):
    kw.pop('y')
    report('popped: y popped')


def generator(*args, **kw):
    args = None
    report('generator: args dropped')
    yield
    kw = None
    report('generator: kw dropped')


class C:
    def method(self, *args, **kw):
        args = None
        report('method: args dropped')
        kw = None
        report('method: kw dropped')


def run():
    only_kw(x=Noisy('x'), y=Noisy('y'), z=Noisy('z'))
    report('after')
    only_args(Noisy('0'), Noisy('1'), Noisy('2'))
    report('after')
    both(1, Noisy('0'), Noisy('1'), Noisy('2'), x=Noisy('x'), y=Noisy('y'), z=Noisy('z'))
    report('after')
    named(1, z=Noisy('z'), c=Noisy('c'), y=Noisy('y'), b=Noisy('b'), x=Noisy('x'))
    report('after')
    named(1, b=Noisy('b'), c=Noisy('c'), x=Noisy('x'), y=Noisy('y'), z=Noisy('z'))
    report('after')
    popped(x=Noisy('x'), y=Noisy('y'), z=Noisy('z'))
    report('after')
    for _ in generator(Noisy('0'), Noisy('1'), x=Noisy('x'), y=Noisy('y')):
        pass
    report('after')
    c = C()
    c.method(Noisy('0'), Noisy('1'), Noisy('2'), x=Noisy('x'), y=Noisy('y'))
    report('after')
    bound = c.method
    bound(Noisy('0'), Noisy('1'), Noisy('2'), x=Noisy('x'), y=Noisy('y'))
    report('after')
    only_kw(a=Noisy('a'), b=Noisy('b'), c=Noisy('c'), d=Noisy('d'), e=Noisy('e'), f=Noisy('f'), g=Noisy('g'), h=Noisy('h'), i=Noisy('i'), j=Noisy('j'))
    report('after')


run()
run()
