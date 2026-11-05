# 'a%sb' % (x,): what the compiler makes of a literal format and a tuple that is written out.
import itertools

UNITS = ['%s', '%r', '%a', '%d', '%%', '%5s', '%-5s', '%05s', '%+5s', '% 5s', '%#5s', '%.3s', '%5.3s', '%-5.3r', '%.s', '%5.s', '%0s', '%00s', '%-0s', '%99s', '%100s',
         '%.99s', '%.100s', '%099s', '%0100s', '%-+ #05.2a', '%*s', '%.*s', '%(k)s', '%ls', '%c', '%', '%5', '%5.', '%-', 'x', '', 'Ā', '{', '}', '{0}', '%S', '%5%', '%s%%']


class Odd(str):
    def __str__(self):
        return 'str of Odd'

    def __repr__(self):
        return 'repr of OddĀ'

    def __format__(self, spec):
        return 'format of Odd'


VALUES = {'a': 'text', 'b': 12, 'c': Odd('odd'), 'd': None}


def attempt(source):
    code = compile(source, '<test>', 'eval')
    try:
        value = eval(code, dict(VALUES))
    except Exception as e:
        value = type(e).__name__ + ': ' + str(e)
    print(ascii(source), ascii(tuple('code' if hasattr(c, 'co_code') else c for c in code.co_consts)), ascii(code.co_names), ascii(value))


for first, second in itertools.product(UNITS, UNITS):
    for items in ('()', '(a,)', '(a, b)', '(c, 1)'):
        attempt(repr(first + '|' + second) + ' % ' + items)
