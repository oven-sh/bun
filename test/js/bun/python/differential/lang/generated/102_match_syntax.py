try:
    def c(src):
        try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
        except SyntaxError as e: print(type(e).__name__ + ":", e.msg, "<-", src.replace("\n", "\\n"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c(src):')
try:
    def p(pattern, guard=""):
        c("match x:\n case %s%s: pass" % (pattern, guard))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def p(pattern, guard=""):')

try:
    for pat in ("1", "-1", "+1", "--1", "1.5", "-1.5", "1j", "-1j", "1+2j", "1-2j", "-1+2j", "1+2", "1j+2", "1+2j+3", "1*2", "1+-2j", "(1)+2j", "1 + 2.5j", "1.5 + 2j", "1j + 2j", "'a'", "'a' 'b'", "b'a'", "'a' b'b'", "f'a'", "f'{x}'", "'a' f'b'", "t'a'", "None", "True", "False", "...", "Ellipsis", "NotImplemented", "__debug__", "-None", "-True", "-'a'", "not 1", "~1", "1 if y else 2", "x", "_", "x.y", "x.y.z", "_.y", "x._", ".x", "x.", "x.1", "x.y()", "x().y", "x[0]", "x.y[0]", "x + 1", "x.y + 1", "-x", "-x.y", "(x)", "((x))", "(1)", "()", "(x,)", "(x, y)", "(x, y,)", "x,", "x, y", "x, y,", "[]", "[x]", "[x,]", "[x, y]", "[,]", "(,)", "*x", "*_", "*x,", "*x, y", "x, *y", "[*x]", "[*_]", "[*x, *y]", "(*x, *y)", "*x, *y", "[x, *y, z]", "[*x.y]", "[*1]", "[*(x)]", "[*[x]]", "[**x]", "(*x)", "[* x]", "{}", "{1: x}", "{'a': x}", "{'a': x,}", "{'a': 1, 'b': 2}", "{x: 1}", "{x.y: 1}", "{_: 1}", "{None: 1}", "{True: 1}", "{-1: x}", "{1+2j: x}", "{(1): x}", "{[1]: x}", "{(1, 2): x}", "{f'a': x}", "{'a' 'b': x}", "{b'a': x}", "{1: x, 1: y}", "{'a': x, 'a': y}", "{None: x, None: y}", "{1: x, 1.0: y}", "{True: x, 1: y}", "{x.y: 1, x.y: 2}", "{**x}", "{**_}", "{**x,}", "{'a': 1, **x}", "{**x, 'a': 1}", "{**x, **y}", "{**x.y}", "{**{}}", "{**1}", "{'a'}", "{'a',}", "{'a': }", "{: x}", "{*x}", "{'a': *x}", "{'a': x for x in y}", "{1: x | y}", "{1: (x | y)}", "{1: 1 | 2}", "{1 | 2: x}", "C()", "C(1)", "C(x)", "C(x, y)", "C(x,)", "C(a=1)", "C(a=x)", "C(a=x,)", "C(1, a=x)", "C(a=x, 1)", "C(a=1, a=2)", "C(a=1, b=2)", "C(*x)", "C(**x)", "C(a.b=1)", "C(1=x)", "C('a'=x)", "C(a=)", "C(=x)", "C(,)", "C(x y)", "C(a:=1)", "C((a:=1))", "C(_=1)", "C(a=_)", "C(None=1)", "C(True=1)", "C(__debug__=1)", "C(x)(y)", "C.D()", "C.D.E(x)", "C().D", "C[int]()", "1()", "'a'()", "None()", "_()", "(C)()", "C ()", "C(x for x in y)", "C(x=y=1)", "int(x) | str(x)", "1 | 2", "1 | 2 | 3", "x | 1", "1 | x", "x | y", "_ | 1", "1 | _", "(x) | 1", "x | x", "(1, x) | (x, 1)", "(1, x) | (y, 1)", "(1, x) | (1, 2)", "[x] | [x, y]", "{1: x} | {2: x}", "{1: x} | {2: y}", "C(x) | D(x)", "C(x) | D(y)", "1 | (2 | 3)", "(1 | 2) | 3", "| 1", "1 |", "1 || 2", "1 or 2", "1 and 2", "1 | 2 as x", "(1 | 2) as x", "1 | (2 as x)", "(1 as x) | (2 as x)", "(1 as x) | (2 as y)", "1 as x", "x as y", "_ as x", "x as _", "1 as _", "x as x", "1 as x as y", "(1 as x) as y", "(1 as x) as x", "1 as x.y", "1 as 2", "1 as (x)", "1 as [x]", "1 as x, y", "1 as x, 2 as y", "[1 as x, 2 as x]", "[x, x]", "(x, x)", "x, x", "[x, [x]]", "[x, *x]", "{1: x, 2: x}", "{1: x, **x}", "C(x, x)", "C(x, a=x)", "C(a=x, b=x)", "[_, _]", "[_, *_]", "{1: _, 2: _}", "C(_, _)", "as x", "1 as", "1 as None", "1 as True", "1 as __debug__", "x := 1", "(x := 1)", "lambda: 1", "x if y else z", "[x for x in y]", "x < 1", "x == 1", "x is None", "x in y", "await x", "yield", "(yield)", "*", "**x", "x: int", "x = 1", "1, 2 | 3", "(1, 2) | 3", "'a' | b'a'", "1 2", "x y", "", "case", "match", "type", "print", "int", "_x", "__", "x.case", "match.case", "case()", "match()", "type()", "x.__class__", "é", "x.é", "1_000", "0x1F", "0b1", "0o7", "1e5", "1E-5", "1_0.0_1", "00", "01", "1__0", "'\\N{DIGIT ONE}'", "r'\\d'", "rb'\\d'", "u'a'", "'''a\nb'''", "-0", "-0.0", "0j", "-0j", "1 - -2j", "1 + 2J", "1--2j", "2j - 1", "(1 + 2j)", "-(1 + 2j)", "-(1)", "1 + (2j)"):
        try: p(pat)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p(pat)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for pat in ("1", "-1", "+1", "--1", "1.5", "-1.5", "1j", "-1j", "1+2j...')
try:
    for g in (" if y", " if", " if y if z", " if y else z", " if (y if z else w)", " if y:= 1", " if (y := 1)", " if not y", " if y and z or w", " if lambda: 1", " if *y", " if y, z", " if (y, z)", " if yield", " if (yield)", " if await y", " if x", " if _", " if y for y in z", " if [y for y in z]", " if y == 1 if z else w", " if 1", " if None", " when y", " and y", " if y as z"):
        try: p("x", g)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p("x", g)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for g in (" if y", " if", " if y if z", " if y else z", " if (y if z ...')
# Irrefutable patterns must come last.
try: c("match x:\n case y: pass\n case 1: pass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c("match x:\\n case y: pass\\n case 1: pass")')
try: c("match x:\n case _: pass\n case 1: pass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c("match x:\\n case _: pass\\n case 1: pass")')
try: c("match x:\n case _: pass\n case _: pass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c("match x:\\n case _: pass\\n case _: pass")')
try: c("match x:\n case y if True: pass\n case 1: pass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c("match x:\\n case y if True: pass\\n case 1: pass")')
try: c("match x:\n case (y): pass\n case 1: pass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c("match x:\\n case (y): pass\\n case 1: pass")')
try: c("match x:\n case y as z: pass\n case 1: pass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c("match x:\\n case y as z: pass\\n case 1: pass")')
try: c("match x:\n case _ as z: pass\n case 1: pass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c("match x:\\n case _ as z: pass\\n case 1: pass")')
try: c("match x:\n case 1 | y: pass\n case 2: pass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c("match x:\\n case 1 | y: pass\\n case 2: pass")')
try: c("match x:\n case y | 1: pass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c("match x:\\n case y | 1: pass")')
try: c("match x:\n case _ | 1: pass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c("match x:\\n case _ | 1: pass")')
try: c("match x:\n case (y | 1): pass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c("match x:\\n case (y | 1): pass")')
try: c("match x:\n case [y | 1]: pass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c("match x:\\n case [y | 1]: pass")')
try: c("match x:\n case [y]: pass\n case 1: pass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c("match x:\\n case [y]: pass\\n case 1: pass")')
try: c("match x:\n case 1: pass\n case y: pass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c("match x:\\n case 1: pass\\n case y: pass")')
try: c("match x:\n case (1 | y) as z: pass\n case 2: pass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c("match x:\\n case (1 | y) as z: pass\\n case 2: pass")')
try: c("match x:\n case 1 | 2 | _: pass\n case 3: pass")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c("match x:\\n case 1 | 2 | _: pass\\n case 3: pass")')
# The statement itself.
try:
    for src in ("match x:\n case 1: pass", "match x:\n  case 1:\n    pass", "match x: case 1: pass", "match x:\n pass", "match x:\n case 1: pass\n pass", "match x:\n case 1: pass\nelse: pass", "match x:\n case 1: pass\n else: pass", "match x:", "match x:\n", "match:\n case 1: pass", "match x\n case 1: pass", "match x:\n case 1 pass", "match x:\n case 1:", "match x:\n case 1:\n case 2: pass", "match x:\n case: pass", "match x:\ncase 1: pass", "match x, y:\n case 1: pass", "match x,:\n case 1: pass", "match (x, y):\n case 1: pass", "match *x:\n case 1: pass", "match *x,:\n case 1: pass", "match *x, *y:\n case 1: pass", "match x, *y:\n case 1: pass", "match **x:\n case 1: pass", "match x := 1:\n case 1: pass", "match (x := 1):\n case 1: pass", "match x = 1:\n case 1: pass", "match x if y else z:\n case 1: pass", "match lambda: 1:\n case 1: pass", "match yield:\n case 1: pass", "match (yield):\n case 1: pass", "def f():\n match (yield):\n  case 1: pass", "def f():\n match yield:\n  case 1: pass", "def f():\n match yield x:\n  case 1: pass", "match await x:\n case 1: pass", "async def f():\n match await x:\n  case 1: pass", "match not x:\n case 1: pass", "match -x:\n case 1: pass", "match [x]:\n case 1: pass", "match {x}:\n case 1: pass", "match (x):\n case 1: pass", "match(x):\n case 1: pass", "match()", "match():\n case 1: pass", "match ():\n case (): pass", "match x for x in y:\n case 1: pass", "match x y:\n case 1: pass", "match 'a' 'b':\n case 1: pass", "match ...:\n case 1: pass", "match x:\n case 1: pass; pass", "match x:\n case 1: return", "match x:\n case 1: break", "match x:\n case 1: continue", "for i in y:\n match x:\n  case 1: break\n  case 2: continue", "match x:\n case 1: pass\n\n case 2: pass", "match x:\n # comment\n case 1: pass\n # comment\n case 2: pass", "match x:\n case 1: pass\n  case 2: pass", "match x:\n  case 1: pass\n case 2: pass", "match x:\n case 1:\n  match y:\n   case 2: pass", "match x:\n case (\n  1\n ): pass", "match x:\n case [\n  1,\n  2\n ]: pass", "match x:\n case 1 |\\\n 2: pass", "match (\n x\n):\n case 1: pass", "match x:\n case 1: x = 1\n case 2: y = 2", "if 1:\n match x:\n  case 1: pass\nelse: pass", "match x:\n case 1: pass\nmatch y:\n case 2: pass", "match = 1", "match: int = 1", "match += 1", "match.x = 1", "match[0] = 1", "match, case = 1, 2", "match * 2", "match - 1", "match -1", "match (1)", "match [1]", "match {1}", "match (1), 2", "match(1)[0]", "match.x()", "match\n", "match;", "print(match)", "del match", "case = 1", "case 1: pass", "case: int", "case(1)", "case [1]", "def match(): pass", "def case(): pass", "class match: pass", "import match", "from match import case", "lambda match: case", "for match in case: pass", "with match as case: pass", "match if case else 1", "match is None", "match in case", "match or case", "match == 1", "[match for match in case]", "match: pass", "match x: pass", "_ = 1", "_: int = 1", "def _(): pass", "type = 1", "type(x)", "type X = int", "type: int", "print(type)", "soft = match = case = type = _ = 1"):
        try: c(src)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c(src)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for src in ("match x:\\n case 1: pass", "match x:\\n case 1:\\n pass", "...')
