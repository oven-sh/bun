# Long subjects of each kind, matched piecemeal: what _sre remembers about the last subject must not leak into the next.
import re

token = re.compile(r'\w+|\s+|.', re.S)

def tokens(s):
    pos, out = 0, []
    while pos < len(s):
        m = token.match(s, pos)
        out.append((m.span(), m.group()))
        pos = m.end()
    return out

latin = 'ab \xe9\xe8, ' * 100
wide = '\u0434\u0430 \u043d\u0435\u0442, ' * 100
wide2 = '\u4e00\u4e8c \u4e09, ' * 120
astral = 'a\U0001f600 \U00010400b, ' * 100
astral2 = '\U0001f600\U0001f601 x, ' * 120
lone = '\ud800a \udc00\ud800 b, ' * 100
for s in (latin, wide, wide2, astral, astral2, lone, wide, astral, wide2, astral2, latin):
    t = tokens(s)
    print(len(s), len(t), ascii(t[:6]), ascii(t[-3:]), ''.join(x for _, x in t) == s)

# Interleaved.
its = [token.finditer(s) for s in (latin, wide, astral, wide2, astral2, lone)]
for i in range(40):
    print(ascii([(m.span(), m.group()) for m in map(next, its)]))
ms = [token.search(s, 300) for s in (latin, wide, astral, wide2, astral2, lone)]
print(ascii([(m.span(), m.group(), m.string is s) for m, s in zip(ms, (latin, wide, astral, wide2, astral2, lone))]))
for s in (latin, wide, astral, lone):
    m = re.fullmatch(r'(?s)(.)(.*)(.)', s)
    print(m.span(), m.regs, ascii(m.group(1, 3)), m.group() is s, m.group(2) == s[1:-1], len(m.group(2)))
    print(ascii(re.sub(r'\W+', '-', s)[:40]), ascii(re.split(r',\s', s)[:3]), len(re.findall(r'\S+', s)), ascii(re.findall(r'\S+', s)[-2:]))
    print(ascii(re.sub(r'(\w)(\W)', r'\2\1', s)[-30:]), ascii(re.subn(r'.', lambda m: m.group() * 2, s, count=3)[0][:12]))
# Equal strings that are not the same object.
a1 = 'x\U0001f600' * 200
a2 = ''.join(['x\U0001f600'] * 200)
print(token.match(a1, 399).span(), token.match(a2, 399).span(), token.match(a1, 1).group() == token.match(a2, 1).group())
