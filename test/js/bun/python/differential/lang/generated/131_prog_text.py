# Text processing programs.
try: TEXT = """The quick brown fox jumps over the lazy dog. The dog barks; the fox runs away!
It was the best of times, it was the worst of times, it was the age of wisdom,
it was the age of foolishness... "Quoted text," she said, isn't it?
Ünïcödé wörds — naïve café résumé — and emoji 😀 too."""
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TEXT = """The quick brown fox jumps over the lazy dog. The dog barks;...')

try:
    def words(s): return ["".join(c for c in w if c.isalnum() or c == "'").lower() for w in s.split() if any(c.isalnum() for c in w)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def words(s): return ["".join(c for c in w if c.isalnum() or c == "\'"...')
try: ws = words(TEXT)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ws = words(TEXT)')
try: freq = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: freq = {}')
try:
    for w in ws: freq[w] = freq.get(w, 0) + 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for w in ws: freq[w] = freq.get(w, 0) + 1')
try: top = sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: top = sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))')
try: print('len(ws) =>', len(ws))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(ws)')
try: print('len(freq) =>', len(freq))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(freq)')
try: print('top[:8] =>', top[:8])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: top[:8]')
try: print('max(ws, key=len) =>', max(ws, key=len))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: max(ws, key=len)')
try: print('sorted(set(w for w in ws if len(w) > 7)) =>', sorted(set(w for w in ws if len(w) > 7)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(set(w for w in ws if len(w) > 7))')
try: print('sum(map(len, ws)) =>', sum(map(len, ws)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(map(len, ws))')
try:
    for w, n in top[:5]: print(f"{w:<8}{n:>3} {'#' * n}")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for w, n in top[:5]: print(f"{w:<8}{n:>3} {\'#\' * n}")')
try: lines = TEXT.splitlines()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lines = TEXT.splitlines()')
try: print('len(lines) =>', len(lines))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(lines)')
try: print('[len(l) for l in lines] =>', [len(l) for l in lines])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [len(l) for l in lines]')
try: print('[l.split()[0] for l in lines] =>', [l.split()[0] for l in lines])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [l.split()[0] for l in lines]')
try: print('[l[-5:] for l in lines] =>', [l[-5:] for l in lines])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [l[-5:] for l in lines]')
try: print('TEXT.count("the") =>', TEXT.count("the"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TEXT.count("the")')
try: print('TEXT.lower().count("the") =>', TEXT.lower().count("the"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TEXT.lower().count("the")')
try: print('TEXT.find("fox") =>', TEXT.find("fox"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TEXT.find("fox")')
try: print('TEXT.rfind("fox") =>', TEXT.rfind("fox"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TEXT.rfind("fox")')
try: print('TEXT.index("dog") =>', TEXT.index("dog"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TEXT.index("dog")')
try: print('TEXT.count("\\n") =>', TEXT.count("\n"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TEXT.count("\\n")')
try: print('TEXT.upper()[:20] =>', TEXT.upper()[:20])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TEXT.upper()[:20]')
try: print('TEXT.title()[:30] =>', TEXT.title()[:30])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TEXT.title()[:30]')
try: print('TEXT.swapcase()[:20] =>', TEXT.swapcase()[:20])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TEXT.swapcase()[:20]')
try: print('len(TEXT) =>', len(TEXT))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(TEXT)')
try: print('len(TEXT.encode()) =>', len(TEXT.encode()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(TEXT.encode())')
try:
    def caesar(s, k): return "".join(chr((ord(c) - b + k) % 26 + b) if c.isascii() and c.isalpha() and (b := 65 if c.isupper() else 97) else c for c in s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def caesar(s, k): return "".join(chr((ord(c) - b + k) % 26 + b) if c....')
try: enc = caesar("Hello, World!", 3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: enc = caesar("Hello, World!", 3)')
try: print('enc =>', enc)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: enc')
try: print('caesar(enc, -3) =>', caesar(enc, -3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: caesar(enc, -3)')
try: print('caesar("xyz ABC", 13) =>', caesar("xyz ABC", 13))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: caesar("xyz ABC", 13)')
try: print('caesar(caesar(lines[0], 13), 13) == lines[0] =>', caesar(caesar(lines[0], 13), 13) == lines[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: caesar(caesar(lines[0], 13), 13) == lines[0]')
try:
    def vigenere(s, key, sign=1):
        out = []; i = 0
        for c in s:
            if c.isalpha() and c.isascii(): out.append(chr((ord(c.upper()) - 65 + sign * (ord(key[i % len(key)]) - 65)) % 26 + 65)); i += 1
            else: out.append(c)
        return "".join(out)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def vigenere(s, key, sign=1):')
try: v = vigenere("ATTACK AT DAWN", "LEMON")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v = vigenere("ATTACK AT DAWN", "LEMON")')
try: print('v =>', v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v')
try: print('vigenere(v, "LEMON", -1) =>', vigenere(v, "LEMON", -1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vigenere(v, "LEMON", -1)')
try:
    def rle(s):
        out = []; i = 0
        while i < len(s):
            j = i
            while j < len(s) and s[j] == s[i]: j += 1
            out.append((s[i], j - i)); i = j
        return out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rle(s):')
try:
    def unrle(p): return "".join(c * n for c, n in p)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def unrle(p): return "".join(c * n for c, n in p)')
try: r = rle("aaabccddddde😀😀")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = rle("aaabccddddde😀😀")')
try: print('r =>', r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r')
try: print('"".join("%s%d" % p for p in r) =>', "".join("%s%d" % p for p in r))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "".join("%s%d" % p for p in r)')
try: print('unrle(r) =>', unrle(r))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: unrle(r)')
try:
    def is_pal(s): t = [c.lower() for c in s if c.isalnum()]; return t == t[::-1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def is_pal(s): t = [c.lower() for c in s if c.isalnum()]; return t ==...')
try: print([is_pal(s) for s in ("A man, a plan, a canal: Panama", "Was it a car or a cat I saw?", "Not a palindrome", "", "été", "😀a😀")])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [is_pal(s) for s in ("A man, a plan, a canal: Panama", "Was it a car ...')
try: groups = {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: groups = {}')
try:
    for w in "listen silent enlist google elgoog inlets banana tinsel abc cab bca".split(): groups.setdefault("".join(sorted(w)), []).append(w)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for w in "listen silent enlist google elgoog inlets banana tinsel abc...')
try: print(sorted(groups.values(), key=lambda g: (-len(g), g)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(groups.values(), key=lambda g: (-len(g), g))')
try:
    def wrap(s, width):
        out = []; cur = ""
        for w in s.split():
            if cur and len(cur) + 1 + len(w) > width: out.append(cur); cur = w
            else: cur = (cur + " " + w) if cur else w
        return out + [cur] if cur else out
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def wrap(s, width):')
try:
    def justify(line, width):
        ws = line.split()
        if len(ws) == 1: return ws[0].ljust(width)
        gaps = len(ws) - 1; spaces = width - sum(map(len, ws)); q, r = divmod(spaces, gaps)
        return "".join(w + " " * (q + (i < r)) for i, w in enumerate(ws[:-1])) + ws[-1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def justify(line, width):')
try:
    for l in wrap(lines[1] + " " + lines[2], 30): print("|" + justify(l, 30) + "|")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for l in wrap(lines[1] + " " + lines[2], 30): print("|" + justify(l, ...')
try:
    for l in wrap(lines[0], 24): print("[" + l.center(24, ".") + "]", "[" + l.rjust(24) + "]")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for l in wrap(lines[0], 24): print("[" + l.center(24, ".") + "]", "["...')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def parse_csv(text):')
try: rows = parse_csv('name,age,note\nAlice,30,"likes, commas"\nBob,25,"says ""hi"""\n"Zoë",41,\n,,')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: rows = parse_csv(\'name,age,note\\nAlice,30,"likes, commas"\\nBob,25,"sa...')
try: print(rows)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: rows')
try: head, *body = rows
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: head, *body = rows')
try: recs = [dict(zip(head, r)) for r in body]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: recs = [dict(zip(head, r)) for r in body]')
try: print('recs[0] =>', recs[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: recs[0]')
try: print('[r["name"] for r in recs] =>', [r["name"] for r in recs])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [r["name"] for r in recs]')
try: print('sum(int(r["age"] or 0) for r in recs) =>', sum(int(r["age"] or 0) for r in recs))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(int(r["age"] or 0) for r in recs)')
try: widths = [max(len(r[i]) for r in rows) for i in range(3)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: widths = [max(len(r[i]) for r in rows) for i in range(3)]')
try:
    for r in rows: print(" | ".join(c.ljust(w) for c, w in zip(r, widths)).rstrip())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for r in rows: print(" | ".join(c.ljust(w) for c, w in zip(r, widths)...')
# A tokenizer and a recursive-descent calculator.
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def tokenize(s):')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Calc:')
try: calc = Calc()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: calc = Calc()')
try:
    for src in ("1 + 2 * 3", "(1 + 2) * 3", "2 ** 3 ** 2", "-2 ** 2", "10 / 4", "10 // 4", "10 % 4", "x = 5", "y = x * 2 + 1", "x * y - -3", "max(1, x, y) + min(4, 2)", "abs(-7.5)", "2 * pi", "1 +", "(1", "1 / 0", "z + 1", "1 $ 2", "1 2", "max()", "((((7))))", "1.5.2"):
        try: print(src, "=>", calc.run(src))
        except Exception as e: print(src, "=>", type(e).__name__ + ":", e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("1 + 2 * 3", "(1 + 2) * 3", "2 ** 3 ** 2", "-2 ** 2", "10...')
try:
    def substitute(tpl, **kw):
        out = []; i = 0
        while i < len(tpl):
            if tpl[i:i + 2] == "${":
                j = tpl.index("}", i); key, _, default = tpl[i + 2:j].partition(":"); out.append(str(kw.get(key, default))); i = j + 1
            else: out.append(tpl[i]); i += 1
        return "".join(out)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def substitute(tpl, **kw):')
try: print(substitute("Dear ${name}, you owe ${amount:nothing} by ${date:tomorrow}.", name="Ann", amount=12.5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: substitute("Dear ${name}, you owe ${amount:nothing} by ${date:tomorro...')
try: MORSE = dict(zip("abcdefghijklmnopqrstuvwxyz", ".- -... -.-. -.. . ..-. --. .... .. .--- -.- .-.. -- -. --- .--. --.- .-. ... - ..- ...- .-- -..- -.-- --..".split()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MORSE = dict(zip("abcdefghijklmnopqrstuvwxyz", ".- -... -.-. -.. . .....')
try: REV = {v: k for k, v in MORSE.items()}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: REV = {v: k for k, v in MORSE.items()}')
try: m = " / ".join(" ".join(MORSE[c] for c in w) for w in "hello world".split())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m = " / ".join(" ".join(MORSE[c] for c in w) for w in "hello world".s...')
try: print('m =>', m)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m')
try: print("|", '" ".join("".join(REV[c] for c in w.split()) for w in m.split(" / ")) =>', " ".join("".join(REV[c] for c in w.split()) for w in m.split(" / ")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: " ".join("".join(REV[c] for c in w.split()) for w in m.split(" / "))')
try:
    def snake(s): return "".join("_" + c.lower() if c.isupper() else c for c in s).lstrip("_")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def snake(s): return "".join("_" + c.lower() if c.isupper() else c fo...')
try:
    def camel(s): h, *t = s.split("_"); return h + "".join(w.capitalize() for w in t)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def camel(s): h, *t = s.split("_"); return h + "".join(w.capitalize()...')
try: print('snake("someVariableName") =>', snake("someVariableName"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: snake("someVariableName")')
try: print('camel("some_variable_name") =>', camel("some_variable_name"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: camel("some_variable_name")')
try: print('snake("HTTPServer") =>', snake("HTTPServer"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: snake("HTTPServer")')
try: print('camel("a") =>', camel("a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: camel("a")')
try: print('camel(snake("roundTripName")) =>', camel(snake("roundTripName")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: camel(snake("roundTripName"))')
try:
    def number_words(n):
        ones = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(); tens = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
        if n < 20: return ones[n]
        if n < 100: return tens[n // 10] + ("-" + ones[n % 10] if n % 10 else "")
        if n < 1000: return ones[n // 100] + " hundred" + (" and " + number_words(n % 100) if n % 100 else "")
        for v, name in ((10 ** 9, "billion"), (10 ** 6, "million"), (1000, "thousand")):
            if n >= v: return number_words(n // v) + " " + name + ((", " if n % v >= 100 else " and ") + number_words(n % v) if n % v else "")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def number_words(n):')
try: print([number_words(n) for n in (0, 13, 21, 100, 342, 1000, 1001, 12345, 1000000, 7654321)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [number_words(n) for n in (0, 13, 21, 100, 342, 1000, 1001, 12345, 10...')
try: print("\n".join("%-6s|%6.2f|%+05d|%x|%5s%%" % (n, v, i, i * 255, i * 10) for i, (n, v) in enumerate((("a", 1.5), ("bb", 22.333), ("ccc", -0.125)))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "\\n".join("%-6s|%6.2f|%+05d|%x|%5s%%" % (n, v, i, i * 255, i * 10) fo...')
try: print("\n".join("{:<6}|{:>8,.1f}|{:^7}|{!r:>6}|{:#06x}".format(n, v * 1000, n * 2, n, i + 10) for i, (n, v) in enumerate((("a", 1.5), ("bb", 22.333), ("ccc", -0.125)))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "\\n".join("{:<6}|{:>8,.1f}|{:^7}|{!r:>6}|{:#06x}".format(n, v * 1000,...')
try: table = str.maketrans("aeiou", "43!0_", "xyz")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: table = str.maketrans("aeiou", "43!0_", "xyz")')
try: print('"leet speak example xyz".translate(table) =>', "leet speak example xyz".translate(table))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "leet speak example xyz".translate(table)')
try: print('"hello".translate({ord("l"): "L", ord("o"): None, ord("h"): 0x1F600}) =>', "hello".translate({ord("l"): "L", ord("o"): None, ord("h"): 0x1F600}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "hello".translate({ord("l"): "L", ord("o"): None, ord("h"): 0x1F600})')
try: print('" ".join(w[::-1] for w in lines[0].split()[:5]) =>', " ".join(w[::-1] for w in lines[0].split()[:5]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: " ".join(w[::-1] for w in lines[0].split()[:5])')
try: print('" ".join(lines[0].split()[:5][::-1]) =>', " ".join(lines[0].split()[:5][::-1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: " ".join(lines[0].split()[:5][::-1])')
try: print('lines[0][::-1][:20] =>', lines[0][::-1][:20])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: lines[0][::-1][:20]')
try: print('"".join(sorted(set(lines[0].lower()) - set(" .;!"))) =>', "".join(sorted(set(lines[0].lower()) - set(" .;!"))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "".join(sorted(set(lines[0].lower()) - set(" .;!")))')
try: print('[w for w in ws if w[0] in "aeiou"][:6] =>', [w for w in ws if w[0] in "aeiou"][:6])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [w for w in ws if w[0] in "aeiou"][:6]')
try: print('{len(w) for w in ws} =>', {len(w) for w in ws})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {len(w) for w in ws}')
try: print('sorted({w[0] for w in ws}) =>', sorted({w[0] for w in ws}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted({w[0] for w in ws})')
try: print('any(w.isdigit() for w in ws) =>', any(w.isdigit() for w in ws))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: any(w.isdigit() for w in ws)')
try: print('all(w == w.lower() for w in ws) =>', all(w == w.lower() for w in ws))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: all(w == w.lower() for w in ws)')
try: print('"é".encode() =>', "é".encode())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "é".encode()')
try: print('"é".encode("latin-1") =>', "é".encode("latin-1"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "é".encode("latin-1")')
try: print('"😀".encode("utf-8") =>', "😀".encode("utf-8"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "😀".encode("utf-8")')
try: print('b"\\xc3\\xa9".decode() =>', b"\xc3\xa9".decode())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b"\\xc3\\xa9".decode()')
try: print('[hex(ord(c)) for c in "aé€😀"] =>', [hex(ord(c)) for c in "aé€😀"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [hex(ord(c)) for c in "aé€😀"]')
try: print('"naïve café".encode("ascii", "replace") =>', "naïve café".encode("ascii", "replace"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "naïve café".encode("ascii", "replace")')
try: print('"naïve café".encode("ascii", "ignore") =>', "naïve café".encode("ascii", "ignore"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "naïve café".encode("ascii", "ignore")')
try: print('"naïve".encode("ascii", "xmlcharrefreplace") =>', "naïve".encode("ascii", "xmlcharrefreplace"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "naïve".encode("ascii", "xmlcharrefreplace")')
try: print('"naïve".encode("ascii", "backslashreplace") =>', "naïve".encode("ascii", "backslashreplace"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "naïve".encode("ascii", "backslashreplace")')
