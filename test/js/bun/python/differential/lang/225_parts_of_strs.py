# Parts of strs, short and long against the whole, of every width of character: they are strs like any other.
import re, sys
texts = {
    "ascii": "".join(chr(97 + i % 26) for i in range(1200)),
    "latin": "".join(chr(0xe0 + i % 30) if i % 7 == 0 else chr(97 + i % 26) for i in range(1200)),
    "one wide at the end": "".join(chr(97 + i % 26) for i in range(1199)) + "一",
    "one wide at the start": "一" + "".join(chr(97 + i % 26) for i in range(1199)),
    "wide": "".join(chr(0x4e00 + i % 50) for i in range(1200)),
    "one astral in the middle": "".join(chr(97 + i % 26) for i in range(600)) + "\U0001f600" + "".join(chr(97 + i % 26) for i in range(599)),
    "astral": "".join(chr(0x1f600 + i % 40) for i in range(1200)),
    "lone surrogates": "".join("\udc80" if i % 11 == 0 else chr(97 + i % 26) for i in range(1200)),
}
def rebuilt(s):
    return "".join([c for c in s])
def digest(s):
    return len(s), sum(ord(c) * (i % 13 + 1) for i, c in enumerate(s)) % 1000003
bounds = [0, 1, 2, 9, 128, 255, 256, 257, 300, 599, 600, 601, 899, 1199, 1200]
for name, text in texts.items():
    total = 0
    table = {}
    for a in bounds:
        for b in bounds:
            part = text[a:b]
            same = rebuilt(part)
            assert part == same and hash(part) == hash(same) and len(part) == max(0, b - a), (name, a, b)
            assert part.encode("utf-8", "surrogatepass") == same.encode("utf-8", "surrogatepass")
            table[part] = (a, b)
            assert table[same] == (a, b)
            if part:
                assert part[0] == text[a] and part[-1] == text[b - 1] and part[len(part) // 2] == text[a + len(part) // 2]
                assert text.find(part) <= a and part in text
            again = part[1:-1]
            assert again == text[a + 1:b - 1] if b - a >= 2 else again == ""
            total += digest(part)[1]
    print(name, total, len(table))
    # Parts of parts of parts.
    s = text
    steps = 0
    while len(s) > 3:
        s = s[1:] if steps % 2 else s[:-1]
        steps += 1
        if steps % 100 == 0:
            print("  ", steps, digest(s), s == text[steps // 2:len(text) - (steps + 1) // 2])
    print("  ", repr(s.encode("unicode_escape")))

print("--- methods that give parts")
line = "alpha,beta;gamma  delta\tepsilon\n"
for name, filler in (("ascii", "x"), ("wide", "一"), ("astral", "\U0001f600")):
    big = (line * 40) + filler * 5 + (line * 40)
    print(name, digest("|".join(big.split(","))), len(big.split()), len(big.splitlines()), digest(big.splitlines()[41]), len(big.rsplit(";", 3)[0]))
    print("  ", [digest(p) for p in big.partition(filler)], [digest(p) for p in big.rpartition("gamma")])
    print("  ", digest(big.strip("alph")), digest(big.lstrip()), digest(big.rstrip("\n")), digest(big.removeprefix("alpha")), digest(big.removesuffix("epsilon\n")))
    m = re.search(r"(delta)\s(\w+)\n" + filler + "+(alpha)", big)
    print("  ", m.groups(), m.span(), digest(m.group()), digest(m.string[:m.start()]))
    print("  ", len(re.findall(r"\w+", big)), digest("".join(re.split(r"[,;]", big))), [digest(x) for x in re.findall(filler + "+", big)])
    words = {w: i for i, w in enumerate(big.split())}
    print("  ", sorted(words.items())[:3], "alpha,beta;gamma" in words)

print("--- a part outlives the whole")
import gc
kept = []
for i in range(200):
    whole = ("%06d" % i) * 5000
    kept.append(whole[12:24])
    kept.append(whole[:20000])
    del whole
gc.collect()
print(kept[0], kept[-2], len(kept[-1]), kept[-1][:12], len({k for k in kept}))
print(sys.intern(kept[0]) == "000000000000")
