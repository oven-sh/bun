# f'{x!r:{y}}': the value is converted before what is in the format spec is looked at.
LOG = []
class Fm:
    def __format__(self, spec):
        LOG.append(('format', spec))
        return '5'
    def __repr__(self):
        LOG.append('repr')
        return 'R'
    def __str__(self):
        LOG.append('str')
        return 'S'
fm = Fm()
for f in (lambda: f'{fm!r:{fm}}', lambda: f'{fm!s:>{fm}}', lambda: f'{fm!a:{fm}.{fm}}'):
    LOG.clear()
    print(repr(f()), LOG)


class Sub(str):
    def __format__(self, spec):
        LOG.append(('format of the result', spec))
        return 'F'


class ReprIsSub:
    def __repr__(self):
        LOG.append('repr')
        return Sub('sub')


r = ReprIsSub()
for f in (lambda: f'{r!r}', lambda: f'{r!r:>4}', lambda: f'{r!r:{fm}}', lambda: f'{r!r:{"x"}}', lambda: f'{fm:{fm}}', lambda: f'{fm=!r:{fm}}'):
    LOG.clear()
    print(repr(f()), LOG)


class Fails:
    def __repr__(self):
        raise ValueError('repr')

    def __format__(self, spec):
        raise KeyError('format')


for f in (lambda: f'{Fails()!r:{Fails()}}', lambda: f'{1!r:{Fails()}}', lambda: f'{Fails():{Fails()}}'):
    try:
        f()
    except Exception as e:
        print(repr(e))
