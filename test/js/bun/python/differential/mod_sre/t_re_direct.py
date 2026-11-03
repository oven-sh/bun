# The module re as programs use it.
import re

def attempt(f, *args, **kwargs):
    try:
        r = f(*args, **kwargs)
    except BaseException as e:
        extra = ''
        if isinstance(e, re.error):
            extra = ' %r' % ((e.msg, e.pattern, e.pos, e.lineno, e.colno),)
        print('%s: %s%s' % (type(e).__name__, e, extra))
    else:
        print(ascii(r))

print(re.match(r'(\w+) (\w+)', 'Isaac Newton, physicist').groups())
print(re.search(r'(?P<year>\d{4})-(?P<month>\d\d)', 'on 2024-05-17').groupdict())
print(re.fullmatch(r'[a-z]+', 'abc'), re.fullmatch(r'[a-z]+', 'abc1'))
print(re.prefixmatch(r'a', 'ab'), re.prefixmatch(r'b', 'ab'))
print(re.findall(r'\b\w', 'the quick brown fox'), re.findall(r'(\w)(\d)', 'a1 b2'), re.findall(r'', 'ab'))
print(re.split(r'\W+', 'Words, words, words.'), re.split(r'(\W+)', 'Words, words.'), re.split(r'\W+', 'a b c', maxsplit=1), re.split(r'x*', 'axbc'), re.split(r'\b', 'a b'))
print(re.sub(r'def\s+([a-zA-Z_]\w*)\s*\(\s*\):', r'static PyObject*\npy_\1(void)\n{', 'def myfunc():'))
print(re.sub(r'-{1,2}', lambda m: ' ' if m.group(0) == '-' else '-', 'pro----gram-files'), re.sub(r'x*', '-', 'abxd'), re.subn(r'a', 'b', 'aaa', count=2))
print(re.sub(r'(?P<a>.)(?P<b>.)', r'\g<b>\g<a>\g<0>\g<1>\2', 'abcd'), re.sub('a', r'\n\t\\\r\a\f\v\b', 'a') == '\n\t\\\r\a\f\v\b', re.sub('(a)', r'\g<1>0', 'a'), re.sub('', '-', 'abc'))
print(re.escape('a.b*c[d]\\ e-f\n\u20ac'), re.escape(b'a.b\xff'), re.escape(''))
print([m.span() for m in re.finditer(r'a+', 'baaab a')], [m.group() for m in re.finditer(r'\d', '1a2')])
print(re.compile('a', re.I | re.M), re.compile('a').flags, re.compile(b'a').flags, re.compile('(?i)a').flags, re.compile('a', re.A).flags, re.I, re.IGNORECASE | re.S, re.RegexFlag(0), re.NOFLAG, repr(re.X))
print(re.compile(re.compile('a')).pattern)
attempt(re.compile, re.compile('a'), re.I)
print(re.compile('a') is re.compile('a'), re.compile('a') == re.compile('a', re.U))
re.purge()
print(type(re.compile('')), type(re.match('', '')), re.Pattern, re.Match, re.error is re.PatternError, re.PatternError.__mro__)
print(re.match(r'''
    (\d+)   # whole part
    \.      # point
    (\d*)   # fraction
''', '3.14', re.X).groups(), re.match(r'(?x) a b # c', 'ab'), re.match(r'a.b', 'a\nb', re.S), re.findall(r'^\w', 'a\nb', re.M), re.findall(r'\w$', 'a\nb\n', re.M))

for pattern in ['(', ')', '(?P<a>x)(?P<a>y)', '*', 'a**', 'a{2,1}', '[z-a]', '[', '[a', '\\', '(?P<1a>x)', '(?P=a)', '(?<=a+)b', '\\1', '(a)\\2', '(?(1)a)', '(?(a)b)', '(?i', '(?z)', 'a(?i)b', '(?P<a', '(?P', '(?#', '(?<a)',
                '\\N{nope}', '\\N', '\\x1', '\\u12', '\\U00110000', '\\777', '\\8', '\\q', '[\\q]', '[\\b-a]', '[\\w-a]', 'a{99999999999999999999}', '(?a)(?u)', '(?L)a', '(?-i)a', '(?i-i:a)', '(?-:a)', '(?>', 'a*+*', 'a++?', '(?(1)a|b|c)', 'x{2}{3}',
                '(?P<\u00e9>a)', '(?P<a b>x)', '()' * 3 + '\\4', '\n(', 'ab\ncd(']:
    attempt(re.compile, pattern)
for pattern in [b'\\u1234', b'\\N{SPACE}', b'(?u)a', b'\xff', b'(?P<\xe9>a)', b'[\xe0-\xff]']:
    attempt(re.compile, pattern)
attempt(re.compile, 'a', re.L)
attempt(re.compile, b'a', re.U)
attempt(re.compile, 'a', re.A | re.U)
attempt(re.compile, 1)
attempt(re.compile, None)
attempt(re.compile, 'a', 'b')
for repl in ['\\', '\\g', '\\g<', '\\g<>', '\\g<a', '\\g<a>', '\\g<1a>', '\\g<2>', '\\2', '\\g<-1>', '\\g<+1>', '\\g<1_0>', '\\q', '\\8', '\\400', '\\g< 1>', '\\x41', '\\N{SPACE}', '\\0', '\\00', '\\01', '\\100', '\\18', '\\g<0>', '\\1']:
    attempt(re.sub, '(a)', repl, 'xay')
attempt(re.sub, b'(a)', b'\\g<\xe9>', b'a')
attempt(re.sub, 'a', b'b', 'a')
attempt(re.sub, b'a', 'b', b'a')
attempt(re.match('(a)(b)?', 'a').expand, r'[\1|\2|\g<0>]')
attempt(re.match(b'(a)(b)?', b'a').expand, rb'[\1|\2|\g<0>]')

scanner = re.Scanner([(r'[0-9]+', lambda s, t: ('int', int(t))), (r'[a-z_]+', lambda s, t: ('name', t)), (r'[-+*/=]', lambda s, t: ('op', t)), (r'\s+', None)])
print(scanner.scan('x = 3 + foo_1 * 42 ?!'))

import copy, pickle
p = re.compile(r'(a)|b', re.I)
print(copy.copy(p) is p, copy.deepcopy(p) is p, pickle.loads(pickle.dumps(p)) == p, pickle.loads(pickle.dumps(p)).flags)
m = p.match('A')
print(copy.copy(m) is m, copy.deepcopy(m) is m)
attempt(pickle.dumps, m)
import weakref
r = weakref.ref(p)
print(r() is p)
attempt(weakref.ref, m)

# Case-insensitive matching beyond ASCII.
print(re.findall(r'(?i)stra\u00dfe', 'STRASSE Stra\u00dfe STRA\u1e9eE'), re.findall(r'(?i)\u03c3', '\u03a3\u03c3\u03c2'), re.findall(r'(?i)[k]', 'kK\u212a'), re.findall(r'(?ia)[k]', 'kK\u212a'),
      re.findall(r'(?i)\u0131', 'iI\u0130\u0131'), re.findall(r'(?i)[\u0400-\u042f]+', '\u0416\u0436\u0451\u0401'), re.findall(r'(?i)\U00010428', '\U00010400\U00010428'))
print(re.findall(r'\d+', '12 \u0663\u0664 \uff11 \u00b2'), re.findall(r'(?a)\d+', '12 \u0663'), re.findall(r'\w+', 'na\u00efve caf\u00e9 \u4e2d\u6587 _x1'), re.findall(r'\s', ' \t\u00a0\u2003\u3000\u200b'))
print(re.findall(rb'\w+', b'na\xefve'), re.findall(rb'(?i)\xe9', b'\xe9\xc9'), re.findall(rb'.', b'\n\xff'), re.sub(rb'\s+', b' ', bytearray(b'a  b\n c')), re.findall(rb'a', memoryview(b'banana')))
import array
print(re.findall(rb'..', array.array('B', b'abcd')), re.search(rb'c', memoryview(b'abcd')[1:]).span(), re.match(rb'a', memoryview(b'abcd')).string.tobytes())
attempt(re.findall, rb'a', memoryview(b'abcdef')[::2])
attempt(re.findall, r'a', memoryview(b'abc'))

# Things that used to go wrong in one engine or another.
print(re.match(r'(a)|b', 'b').groups(), re.match(r'(?:(a)|b)*', 'ab').groups(), re.match(r'(a|b)*', 'ab').groups(), re.match(r'(a*)*', 'b').groups(), re.match(r'(a*)+', 'b').groups(), re.match(r'((a)|(b))*', 'ab').groups())
print(re.search(r'(?<=\d)\D', '1a').span(), re.search(r'(?<!\d)\D', '1ab').span(), re.findall(r'(?=(\w\w))', 'abcd'), re.sub(r'(?<=a)', '-', 'aa'), re.findall(r'\b|\w', 'ab c'))
print(re.match(r'(?:a?)*y', 'z'), re.match(r'(?:a?)*?y', 'ay').span(), re.match(r'(?:a*)*', 'aab').span(), re.fullmatch(r'a|ab', 'ab').span(), re.fullmatch(r'a*?', 'aaa').span(), re.fullmatch(r'(a*?)(a*)', 'aaa').groups())
print(re.match(r'a*+a', 'aaa'), re.match(r'(?>a*)a', 'aaa'), re.match(r'a?+a', 'a'), re.match(r'(?>a|ab)c', 'abc'), re.match(r'a{2}+', 'aaa').span(), re.match(r'(?:ab)*+c', 'ababc').span())
print(len(re.match(r'(?:a|b)*', 'ab' * 20000).group()), len(re.match(r'(a|b)*?c', 'ab' * 5000 + 'c').group()), len(re.findall(r'a', 'a' * 30000)), re.search(r'x', 'a' * 100000 + 'x').span())
