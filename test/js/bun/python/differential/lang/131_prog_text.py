# Text processing programs.
TEXT = """The quick brown fox jumps over the lazy dog. The dog barks; the fox runs away!
It was the best of times, it was the worst of times, it was the age of wisdom,
it was the age of foolishness... "Quoted text," she said, isn't it?
Ünïcödé wörds — naïve café résumé — and emoji 😀 too."""

def words(s): return ["".join(c for c in w if c.isalnum() or c == "'").lower() for w in s.split() if any(c.isalnum() for c in w)]
ws = words(TEXT); freq = {}
for w in ws: freq[w] = freq.get(w, 0) + 1
top = sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))
print(len(ws), len(freq), top[:8]); print(max(ws, key=len), sorted(set(w for w in ws if len(w) > 7)), sum(map(len, ws)))
for w, n in top[:5]: print(f"{w:<8}{n:>3} {'#' * n}")
lines = TEXT.splitlines(); print(len(lines), [len(l) for l in lines], [l.split()[0] for l in lines], [l[-5:] for l in lines])
print(TEXT.count("the"), TEXT.lower().count("the"), TEXT.find("fox"), TEXT.rfind("fox"), TEXT.index("dog"), TEXT.count("\n"), TEXT.upper()[:20], TEXT.title()[:30], TEXT.swapcase()[:20], len(TEXT), len(TEXT.encode()))
def caesar(s, k): return "".join(chr((ord(c) - b + k) % 26 + b) if c.isascii() and c.isalpha() and (b := 65 if c.isupper() else 97) else c for c in s)
enc = caesar("Hello, World!", 3); print(enc, caesar(enc, -3), caesar("xyz ABC", 13), caesar(caesar(lines[0], 13), 13) == lines[0])
def vigenere(s, key, sign=1):
    out = []; i = 0
    for c in s:
        if c.isalpha() and c.isascii(): out.append(chr((ord(c.upper()) - 65 + sign * (ord(key[i % len(key)]) - 65)) % 26 + 65)); i += 1
        else: out.append(c)
    return "".join(out)
v = vigenere("ATTACK AT DAWN", "LEMON"); print(v, vigenere(v, "LEMON", -1))
def rle(s):
    out = []; i = 0
    while i < len(s):
        j = i
        while j < len(s) and s[j] == s[i]: j += 1
        out.append((s[i], j - i)); i = j
    return out
def unrle(p): return "".join(c * n for c, n in p)
r = rle("aaabccddddde😀😀"); print(r, "".join("%s%d" % p for p in r), unrle(r))
def is_pal(s): t = [c.lower() for c in s if c.isalnum()]; return t == t[::-1]
print([is_pal(s) for s in ("A man, a plan, a canal: Panama", "Was it a car or a cat I saw?", "Not a palindrome", "", "été", "😀a😀")])
groups = {}
for w in "listen silent enlist google elgoog inlets banana tinsel abc cab bca".split(): groups.setdefault("".join(sorted(w)), []).append(w)
print(sorted(groups.values(), key=lambda g: (-len(g), g)))
def wrap(s, width):
    out = []; cur = ""
    for w in s.split():
        if cur and len(cur) + 1 + len(w) > width: out.append(cur); cur = w
        else: cur = (cur + " " + w) if cur else w
    return out + [cur] if cur else out
def justify(line, width):
    ws = line.split()
    if len(ws) == 1: return ws[0].ljust(width)
    gaps = len(ws) - 1; spaces = width - sum(map(len, ws)); q, r = divmod(spaces, gaps)
    return "".join(w + " " * (q + (i < r)) for i, w in enumerate(ws[:-1])) + ws[-1]
for l in wrap(lines[1] + " " + lines[2], 30): print("|" + justify(l, 30) + "|")
for l in wrap(lines[0], 24): print("[" + l.center(24, ".") + "]", "[" + l.rjust(24) + "]")
def parse_csv(text):
    rows = []
    for line in text.split("\n"):
        row = []; cur = ""; q = False; i = 0
        while i < len(line):
            c = line[i]
            if q:
                if c == '"' and line[i + 1:i + 2] == '"': cur += '"'; i += 1
                elif c == '"': q = False
                else: cur += c
            elif c == '"': q = True
            elif c == ",": row.append(cur); cur = ""
            else: cur += c
            i += 1
        rows.append(row + [cur])
    return rows
rows = parse_csv('name,age,note\nAlice,30,"likes, commas"\nBob,25,"says ""hi"""\n"Zoë",41,\n,,'); print(rows)
head, *body = rows; recs = [dict(zip(head, r)) for r in body]; print(recs[0], [r["name"] for r in recs], sum(int(r["age"] or 0) for r in recs))
widths = [max(len(r[i]) for r in rows) for i in range(3)]
for r in rows: print(" | ".join(c.ljust(w) for c, w in zip(r, widths)).rstrip())
# A tokenizer and a recursive-descent calculator.
def tokenize(s):
    i = 0; out = []
    while i < len(s):
        c = s[i]
        if c.isspace(): i += 1
        elif c.isdigit() or c == ".":
            j = i
            while j < len(s) and (s[j].isdigit() or s[j] == "."): j += 1
            out.append(("num", float(s[i:j]) if "." in s[i:j] else int(s[i:j]))); i = j
        elif c.isalpha() or c == "_":
            j = i
            while j < len(s) and (s[j].isalnum() or s[j] == "_"): j += 1
            out.append(("name", s[i:j])); i = j
        elif s[i:i + 2] in ("**", "//", "<=", ">=", "==", "!="): out.append(("op", s[i:i + 2])); i += 2
        elif c in "+-*/%()<>,=": out.append(("op", c)); i += 1
        else: raise SyntaxError("bad character %r at %d" % (c, i))
    return out + [("end", None)]
class Calc:
    def __init__(s, env=None): s.env = dict(env or {}, pi=3.14159, max=max, min=min, abs=abs)
    def run(s, text):
        s.t = tokenize(text); s.i = 0
        if s.t[0][0] == "name" and s.t[1] == ("op", "="):
            name = s.t[0][1]; s.i = 2; s.env[name] = v = s.expr()
        else: v = s.expr()
        if s.peek()[0] != "end": raise SyntaxError("unexpected %r" % (s.peek()[1],))
        return v
    def peek(s): return s.t[s.i]
    def take(s, *ops):
        if s.peek()[0] == "op" and s.peek()[1] in ops: s.i += 1; return s.t[s.i - 1][1]
    def expr(s):
        v = s.term()
        while op := s.take("+", "-"): r = s.term(); v = v + r if op == "+" else v - r
        return v
    def term(s):
        v = s.unary()
        while op := s.take("*", "/", "//", "%"):
            r = s.unary(); v = {"*": lambda: v * r, "/": lambda: v / r, "//": lambda: v // r, "%": lambda: v % r}[op]()
        return v
    def unary(s): return -s.unary() if s.take("-") else s.power()
    def power(s):
        v = s.atom()
        return v ** s.unary() if s.take("**") else v
    def atom(s):
        kind, val = s.peek(); s.i += 1
        if kind == "num": return val
        if kind == "name":
            if val not in s.env: raise NameError("unknown name " + val)
            v = s.env[val]
            if s.take("("):
                args = []
                if not s.take(")"):
                    args.append(s.expr())
                    while s.take(","): args.append(s.expr())
                    if not s.take(")"): raise SyntaxError("expected )")
                return v(*args)
            return v
        if (kind, val) == ("op", "("):
            v = s.expr()
            if not s.take(")"): raise SyntaxError("expected )")
            return v
        raise SyntaxError("unexpected %r" % (val,))
calc = Calc()
for src in ("1 + 2 * 3", "(1 + 2) * 3", "2 ** 3 ** 2", "-2 ** 2", "10 / 4", "10 // 4", "10 % 4", "x = 5", "y = x * 2 + 1", "x * y - -3", "max(1, x, y) + min(4, 2)", "abs(-7.5)", "2 * pi", "1 +", "(1", "1 / 0", "z + 1", "1 $ 2", "1 2", "max()", "((((7))))", "1.5.2"):
    try: print(src, "=>", calc.run(src))
    except Exception as e: print(src, "=>", type(e).__name__ + ":", e)
def substitute(tpl, **kw):
    out = []; i = 0
    while i < len(tpl):
        if tpl[i:i + 2] == "${":
            j = tpl.index("}", i); key, _, default = tpl[i + 2:j].partition(":"); out.append(str(kw.get(key, default))); i = j + 1
        else: out.append(tpl[i]); i += 1
    return "".join(out)
print(substitute("Dear ${name}, you owe ${amount:nothing} by ${date:tomorrow}.", name="Ann", amount=12.5))
MORSE = dict(zip("abcdefghijklmnopqrstuvwxyz", ".- -... -.-. -.. . ..-. --. .... .. .--- -.- .-.. -- -. --- .--. --.- .-. ... - ..- ...- .-- -..- -.-- --..".split())); REV = {v: k for k, v in MORSE.items()}
m = " / ".join(" ".join(MORSE[c] for c in w) for w in "hello world".split()); print(m, "|", " ".join("".join(REV[c] for c in w.split()) for w in m.split(" / ")))
def snake(s): return "".join("_" + c.lower() if c.isupper() else c for c in s).lstrip("_")
def camel(s): h, *t = s.split("_"); return h + "".join(w.capitalize() for w in t)
print(snake("someVariableName"), camel("some_variable_name"), snake("HTTPServer"), camel("a"), camel(snake("roundTripName")))
def number_words(n):
    ones = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(); tens = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
    if n < 20: return ones[n]
    if n < 100: return tens[n // 10] + ("-" + ones[n % 10] if n % 10 else "")
    if n < 1000: return ones[n // 100] + " hundred" + (" and " + number_words(n % 100) if n % 100 else "")
    for v, name in ((10 ** 9, "billion"), (10 ** 6, "million"), (1000, "thousand")):
        if n >= v: return number_words(n // v) + " " + name + ((", " if n % v >= 100 else " and ") + number_words(n % v) if n % v else "")
print([number_words(n) for n in (0, 13, 21, 100, 342, 1000, 1001, 12345, 1000000, 7654321)])
print("\n".join("%-6s|%6.2f|%+05d|%x|%5s%%" % (n, v, i, i * 255, i * 10) for i, (n, v) in enumerate((("a", 1.5), ("bb", 22.333), ("ccc", -0.125)))))
print("\n".join("{:<6}|{:>8,.1f}|{:^7}|{!r:>6}|{:#06x}".format(n, v * 1000, n * 2, n, i + 10) for i, (n, v) in enumerate((("a", 1.5), ("bb", 22.333), ("ccc", -0.125)))))
table = str.maketrans("aeiou", "43!0_", "xyz"); print("leet speak example xyz".translate(table), "hello".translate({ord("l"): "L", ord("o"): None, ord("h"): 0x1F600}))
print(" ".join(w[::-1] for w in lines[0].split()[:5]), " ".join(lines[0].split()[:5][::-1]), lines[0][::-1][:20], "".join(sorted(set(lines[0].lower()) - set(" .;!"))))
print([w for w in ws if w[0] in "aeiou"][:6], {len(w) for w in ws}, sorted({w[0] for w in ws}), any(w.isdigit() for w in ws), all(w == w.lower() for w in ws))
print("é".encode(), "é".encode("latin-1"), "😀".encode("utf-8"), b"\xc3\xa9".decode(), [hex(ord(c)) for c in "aé€😀"], "naïve café".encode("ascii", "replace"), "naïve café".encode("ascii", "ignore"), "naïve".encode("ascii", "xmlcharrefreplace"), "naïve".encode("ascii", "backslashreplace"))
