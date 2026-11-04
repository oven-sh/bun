# Parts of strs, short and long against the whole, of every width of character: they are strs like any other.
try: import re, sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import re, sys')
try: texts = {
    "ascii": "".join(chr(97 + i % 26) for i in range(1200)),
    "latin": "".join(chr(0xe0 + i % 30) if i % 7 == 0 else chr(97 + i % 26) for i in range(1200)),
    "one wide at the end": "".join(chr(97 + i % 26) for i in range(1199)) + "一",
    "one wide at the start": "一" + "".join(chr(97 + i % 26) for i in range(1199)),
    "wide": "".join(chr(0x4e00 + i % 50) for i in range(1200)),
    "one astral in the middle": "".join(chr(97 + i % 26) for i in range(600)) + "\U0001f600" + "".join(chr(97 + i % 26) for i in range(599)),
    "astral": "".join(chr(0x1f600 + i % 40) for i in range(1200)),
    "lone surrogates": "".join("\udc80" if i % 11 == 0 else chr(97 + i % 26) for i in range(1200)),
}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: texts = { "ascii": "".join(chr(97 + i % 26) for i in range(1200)), "l...')
try:
    def rebuilt(s):
        return "".join([c for c in s])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rebuilt(s):')
try:
    def digest(s):
        return len(s), sum(ord(c) * (i % 13 + 1) for i, c in enumerate(s)) % 1000003
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def digest(s):')
try: bounds = [0, 1, 2, 9, 128, 255, 256, 257, 300, 599, 600, 601, 899, 1199, 1200]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bounds = [0, 1, 2, 9, 128, 255, 256, 257, 300, 599, 600, 601, 899, 11...')
try:
    for name, text in texts.items():
        try: total = 0
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: total = 0')
        try: table = {}
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: table = {}')
        for a in bounds:
            for b in bounds:
                try: part = text[a:b]
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: part = text[a:b]')
                try: same = rebuilt(part)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: same = rebuilt(part)')
                try: assert part == same and hash(part) == hash(same) and len(part) == max(0, b - a), (name, a, b)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert part == same and hash(part) == hash(same) and len(part) == max...')
                try: assert part.encode("utf-8", "surrogatepass") == same.encode("utf-8", "surrogatepass")
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert part.encode("utf-8", "surrogatepass") == same.encode("utf-8", ...')
                try: table[part] = (a, b)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: table[part] = (a, b)')
                try: assert table[same] == (a, b)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert table[same] == (a, b)')
                if part:
                    try: assert part[0] == text[a] and part[-1] == text[b - 1] and part[len(part) // 2] == text[a + len(part) // 2]
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert part[0] == text[a] and part[-1] == text[b - 1] and part[len(pa...')
                    try: assert text.find(part) <= a and part in text
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert text.find(part) <= a and part in text')
                try: again = part[1:-1]
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: again = part[1:-1]')
                try: assert again == text[a + 1:b - 1] if b - a >= 2 else again == ""
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assert again == text[a + 1:b - 1] if b - a >= 2 else again == ""')
                try: total += digest(part)[1]
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: total += digest(part)[1]')
        try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'text=' + (repr(text) if type(text) in (str, int, float, bytes, bool, type(None)) or (type(text) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in text)) else text.__name__ if type(text) is type else type(text).__name__) + '] =>', name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
        try: print('total [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'text=' + (repr(text) if type(text) in (str, int, float, bytes, bool, type(None)) or (type(text) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in text)) else text.__name__ if type(text) is type else type(text).__name__) + '] =>', total)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: total')
        try: print('len(table) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'text=' + (repr(text) if type(text) in (str, int, float, bytes, bool, type(None)) or (type(text) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in text)) else text.__name__ if type(text) is type else type(text).__name__) + '] =>', len(table))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(table)')
        # Parts of parts of parts.
        try: s = text
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = text')
        try: steps = 0
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: steps = 0')
        while len(s) > 3:
            try: s = s[1:] if steps % 2 else s[:-1]
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = s[1:] if steps % 2 else s[:-1]')
            try: steps += 1
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: steps += 1')
            if steps % 100 == 0:
                try: print("  ", 'steps [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'text=' + (repr(text) if type(text) in (str, int, float, bytes, bool, type(None)) or (type(text) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in text)) else text.__name__ if type(text) is type else type(text).__name__) + '] =>', steps)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: steps')
                try: print('digest(s) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'text=' + (repr(text) if type(text) in (str, int, float, bytes, bool, type(None)) or (type(text) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in text)) else text.__name__ if type(text) is type else type(text).__name__) + '] =>', digest(s))
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: digest(s)')
                try: print('s == text[steps // 2:len(text) - (steps + 1) // 2] [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'text=' + (repr(text) if type(text) in (str, int, float, bytes, bool, type(None)) or (type(text) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in text)) else text.__name__ if type(text) is type else type(text).__name__) + '] =>', s == text[steps // 2:len(text) - (steps + 1) // 2])
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s == text[steps // 2:len(text) - (steps + 1) // 2]')
        try: print("  ", 'repr(s.encode("unicode_escape")) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'text=' + (repr(text) if type(text) in (str, int, float, bytes, bool, type(None)) or (type(text) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in text)) else text.__name__ if type(text) is type else type(text).__name__) + '] =>', repr(s.encode("unicode_escape")))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(s.encode("unicode_escape"))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name, text in texts.items():')

try: print("--- methods that give parts")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- methods that give parts"')
try: line = "alpha,beta;gamma  delta\tepsilon\n"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: line = "alpha,beta;gamma delta\\tepsilon\\n"')
try:
    for name, filler in (("ascii", "x"), ("wide", "一"), ("astral", "\U0001f600")):
        try: big = (line * 40) + filler * 5 + (line * 40)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: big = (line * 40) + filler * 5 + (line * 40)')
        try: print('name [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', name)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
        try: print('digest("|".join(big.split(","))) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', digest("|".join(big.split(","))))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: digest("|".join(big.split(",")))')
        try: print('len(big.split()) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', len(big.split()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(big.split())')
        try: print('len(big.splitlines()) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', len(big.splitlines()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(big.splitlines())')
        try: print('digest(big.splitlines()[41]) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', digest(big.splitlines()[41]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: digest(big.splitlines()[41])')
        try: print('len(big.rsplit(";", 3)[0]) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', len(big.rsplit(";", 3)[0]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(big.rsplit(";", 3)[0])')
        try: print("  ", '[digest(p) for p in big.partition(filler)] [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', [digest(p) for p in big.partition(filler)])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [digest(p) for p in big.partition(filler)]')
        try: print('[digest(p) for p in big.rpartition("gamma")] [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', [digest(p) for p in big.rpartition("gamma")])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [digest(p) for p in big.rpartition("gamma")]')
        try: print("  ", 'digest(big.strip("alph")) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', digest(big.strip("alph")))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: digest(big.strip("alph"))')
        try: print('digest(big.lstrip()) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', digest(big.lstrip()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: digest(big.lstrip())')
        try: print('digest(big.rstrip("\\n")) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', digest(big.rstrip("\n")))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: digest(big.rstrip("\\n"))')
        try: print('digest(big.removeprefix("alpha")) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', digest(big.removeprefix("alpha")))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: digest(big.removeprefix("alpha"))')
        try: print('digest(big.removesuffix("epsilon\\n")) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', digest(big.removesuffix("epsilon\n")))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: digest(big.removesuffix("epsilon\\n"))')
        try: m = re.search(r"(delta)\s(\w+)\n" + filler + "+(alpha)", big)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m = re.search(r"(delta)\\s(\\w+)\\n" + filler + "+(alpha)", big)')
        try: print("  ", 'm.groups() [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', m.groups())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.groups()')
        try: print('m.span() [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', m.span())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.span()')
        try: print('digest(m.group()) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', digest(m.group()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: digest(m.group())')
        try: print('digest(m.string[:m.start()]) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', digest(m.string[:m.start()]))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: digest(m.string[:m.start()])')
        try: print("  ", 'len(re.findall(r"\\w+", big)) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', len(re.findall(r"\w+", big)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(re.findall(r"\\w+", big))')
        try: print('digest("".join(re.split(r"[,;]", big))) [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', digest("".join(re.split(r"[,;]", big))))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: digest("".join(re.split(r"[,;]", big)))')
        try: print('[digest(x) for x in re.findall(filler + "+", big)] [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', [digest(x) for x in re.findall(filler + "+", big)])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [digest(x) for x in re.findall(filler + "+", big)]')
        try: words = {w: i for i, w in enumerate(big.split())}
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: words = {w: i for i, w in enumerate(big.split())}')
        try: print("  ", 'sorted(words.items())[:3] [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', sorted(words.items())[:3])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(words.items())[:3]')
        try: print('"alpha,beta;gamma" in words [' + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'filler=' + (repr(filler) if type(filler) in (str, int, float, bytes, bool, type(None)) or (type(filler) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in filler)) else filler.__name__ if type(filler) is type else type(filler).__name__) + '] =>', "alpha,beta;gamma" in words)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "alpha,beta;gamma" in words')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for name, filler in (("ascii", "x"), ("wide", "一"), ("astral", "\\U000...')

try: print("--- a part outlives the whole")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "--- a part outlives the whole"')
try: import gc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import gc')
try: kept = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kept = []')
try:
    for i in range(200):
        try: whole = ("%06d" % i) * 5000
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: whole = ("%06d" % i) * 5000')
        try: kept.append(whole[12:24])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kept.append(whole[12:24])')
        try: kept.append(whole[:20000])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kept.append(whole[:20000])')
        try: del whole
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del whole')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(200):')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: print('kept[0] =>', kept[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kept[0]')
try: print('kept[-2] =>', kept[-2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kept[-2]')
try: print('len(kept[-1]) =>', len(kept[-1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(kept[-1])')
try: print('kept[-1][:12] =>', kept[-1][:12])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kept[-1][:12]')
try: print('len({k for k in kept}) =>', len({k for k in kept}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len({k for k in kept})')
try: print(sys.intern(kept[0]) == "000000000000")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.intern(kept[0]) == "000000000000"')
