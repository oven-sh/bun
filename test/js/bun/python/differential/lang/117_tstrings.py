def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

name = "World"; n = 42
tp = t"Hello {name}!"
Template = type(tp); Interpolation = type(tp.interpolations[0])
print(Template.__name__, Template.__module__, Template.__qualname__, Interpolation.__name__, Interpolation.__module__)
print(tp, repr(tp) == str(tp), tp.strings, tp.interpolations, tp.values, type(tp.strings), type(tp.interpolations), type(tp.values))
i = tp.interpolations[0]; print(i, i.value, i.expression, i.conversion, i.format_spec, repr(i))
print(t"", t"".strings, t"".interpolations, t"".values, t"plain".strings, t"{n}".strings, t"{n}{n}".strings, t"a{n}".strings, t"{n}b".strings, t"a{n}b{n}c".strings, t"{n}{n}{n}".values)
for x in (t"{n}", t"{n!r}", t"{n!s}", t"{n!a}", t"{n:>5}", t"{n!r:>5}", t"{n:}", t"{ n }", t"{n }", t"{ n}", t"{n + 1}", t"{n+1}", t"{(n)}", t"{n=}", t"{n = }", t"{n=!s}", t"{n=:>5}", t"{n=!r:>5}", t"{ n = }", t"{n:{n}}", t"{n:{n}.{n}}", t"{n:>{n}}", t"{n:{'x'}>5}", t"{name!r:{n}}", t"{[1, 2][0]}", t"{ {'a': 1}['a'] }", t"{(lambda: 1)()}", t"{name.upper()}", t"{name[0]}", t"{1 if n else 2}", t"{'nested'}", t"{"same quotes"}", t"{f'{n}'}", t"{n:%Y-%m}", t"{n!r:}", t"{n,}", t"{n, n}", t"{*[1, 2],}", t"{n:a{n}b{n}c}"):
    print(x.strings, [(j.value, j.expression, j.conversion, j.format_spec) for j in x.interpolations])
nested = t"{t'{n}'}"; print(type(nested.values[0]).__name__, nested.values[0].values, nested.interpolations[0].expression)
# The format spec is evaluated eagerly like in an f-string, but nothing is formatted.
class Tr:
    def __format__(s, spec): print("__format__ must not be called"); return ""
    def __str__(s): print("__str__ must not be called"); return ""
    def __repr__(s): return "Tr()"
x = t"{Tr()} {Tr()!s} {Tr():>5} {Tr()!r}"; print(x.values, [j.conversion for j in x.interpolations])
log = []
def ev(v): log.append(v); return v
x = t"{ev(1)} {ev(2):{ev(3)}} {ev(4)}"; print(log, x.values)
t(lambda: t"{undefined_name}"); t(lambda: t"{1 / 0}"); t(lambda: t"{n:{undefined_name}}")
# Escapes, braces, prefixes, quoting, concatenation.
print(t"{{}}".strings, t"{{{n}}}".strings, t"a{{b".strings, t"}}".strings, t"\n\t\\".strings, t"\x41\u00e9\N{DIGIT ONE}".strings, t"é😀{n}😀".strings, T"upper {n}".strings, rt"raw\n{n}\d".strings, tr"raw\n".strings, Rt"\n".strings, tR"\n".strings, RT"\n".strings, t'single {n}'.strings, t"""triple
{n}
""".strings, t'''a'b"c{n}'''.strings, rt"{n:\d}".interpolations[0].format_spec, t"{n:\x41}".interpolations[0].format_spec, t"{'\n'}".values, t"{n!r}".interpolations[0].conversion)
print((t"a" t"b").strings, (t"a{n}" t"b{n}c").strings, (t"{n}" t"{n}").strings, (t"a" t"" t"b").strings, (t"a"
   t"b").strings)
x = t"{
    n
}"; print(x.interpolations[0].expression == "\n    n\n", x.values)
x = t"{n  # comment
}"; print(repr(x.interpolations[0].expression), x.values)
# Operations.
a = t"a{n}"; b = t"b{name}c"
print((a + b).strings, (a + b).values, type(a + b).__name__, (a + t"").strings, (t"" + a).strings, (a + a + a).strings)
t(lambda: a + "str"); t(lambda: "str" + a); t(lambda: a + 1); t(lambda: a * 2); t(lambda: a % 1); t(lambda: a == t"a{n}"); t(lambda: a == a); t(lambda: a != a); t(lambda: hash(a) == hash(a)); t(lambda: len(a)); t(lambda: a[0]); t(lambda: bool(t"")); t(lambda: a < a); t(lambda: "a" in a); t(lambda: str(a) == repr(a)); t(lambda: format(a) == repr(a)); t(lambda: format(a, ">5")); t(lambda: f"{a}" == repr(a)); t(lambda: "".join([a])); t(lambda: a.upper()); t(lambda: a.nope); t(lambda: isinstance(a, str)); t(lambda: a())
print(list(a), list(b), list(t""), list(t"{n}"), list(t"{n}{n}"), list(t"x"), [type(p).__name__ for p in t"a{n}b{n}"], type(iter(a)).__name__)
def s1(): a.strings = ()
def s2(): a.x = 1
def s3(): a.interpolations[0].value = 1
def s4(): del a.strings
for s in (s1, s2, s3, s4): t(s)
# Constructors.
print(Template(), Template("a"), Template("a", "b"), Template("a", "b").strings, Template(Interpolation(1, "x")), Template(Interpolation(1, "x")).strings, Template("a", Interpolation(1, "x"), "b", "c", Interpolation(2, "y"), Interpolation(3, "z")).strings, Template("", "").strings)
print(Interpolation(1), Interpolation(1, "e"), Interpolation(1, "e", "r"), Interpolation(1, "e", "r", ">5"), Interpolation(1, "e", None, ""), Interpolation(value=1, expression="e", conversion="s", format_spec="f"), Interpolation(None).value, Interpolation(1).expression == "", Interpolation(1).conversion, Interpolation(1).format_spec == "")
t(lambda: Template(1)); t(lambda: Template(None)); t(lambda: Template("a", 1)); t(lambda: Template(b"a")); t(lambda: Template(strings=())); t(lambda: Template(t"a")); t(lambda: Interpolation()); t(lambda: Interpolation(1, 2)); t(lambda: Interpolation(1, "e", "x")); t(lambda: Interpolation(1, "e", 1)); t(lambda: Interpolation(1, "e", "r", 1)); t(lambda: Interpolation(1, "e", "r", "f", "extra")); t(lambda: Interpolation(1, nope=1)); t(lambda: Interpolation(1, "e", "")); t(lambda: Interpolation(1, "e", "rs")); t(lambda: type("X", (Template,), {})); t(lambda: type("X", (Interpolation,), {}))
print(Interpolation.__match_args__, Interpolation(1, "e") == Interpolation(1, "e"), hash(i) == hash(i), i == i)
match t"{n!r:>3}".interpolations[0]:
    case Interpolation(v, e, c, f): print("matched", v, e, c, f)
match t"x{n}":
    case Template(strings=(s0, s1_), values=(v,)): print("matched", s0, repr(s1_), v)
# A small renderer written on top of templates.
def render(tpl):
    out = []
    for part in tpl:
        if isinstance(part, str): out.append(part)
        else:
            v = part.value
            if part.conversion == "r": v = repr(v)
            elif part.conversion == "s": v = str(v)
            elif part.conversion == "a": v = ascii(v)
            out.append(format(v, part.format_spec))
    return "".join(out)
for tpl, f in ((t"Hello {name}!", f"Hello {name}!"), (t"{n:>6}|{n:<6}|{n:^6}", f"{n:>6}|{n:<6}|{n:^6}"), (t"{name!r:>10}", f"{name!r:>10}"), (t"{n:{n // 10}d}", f"{n:{n // 10}d}"), (t"{n=}", f"{n=}"), (t"{'é'!a}", f"{'é'!a}"), (t"{3.14159:.2f} {1e6:,.0f}", f"{3.14159:.2f} {1e6:,.0f}"), (t"{{{n}}}", f"{{{n}}}")):
    print(render(tpl), render(tpl) == f)
def html(tpl): return "".join(p if isinstance(p, str) else str(p.value).replace("<", "&lt;") for p in tpl)
evil = "<script>"; print(html(t"<p>{evil}</p>"))
# Scope: like f-strings.
def scope():
    loc = "local"
    return t"{loc} {name}".values, [t"{v}".values for v in range(2)], (lambda: t"{loc}")().values
print(scope())
class K:
    attr = 1
    tpl = t"{attr}"
print(K.tpl.values)
def gen(): yield t"{(yield 1)}"
g = gen(); print(next(g), g.send("sent").values)
for src in ('t"{}"', 't"{ }"', 't"{"', 't"}"', 't"{a"', 't"{a!}"', 't"{a!x}"', 't"{a!rr}"', 't"{a! r}"', 't"{a !r}"', 't"{a:{b}"', 't"{a:{}}"', 't"{a:{b:{c}}}"', 't"{a:{b:{c:{d}}}}"', 't"{a b}"', 't"{a=b}"', 't"{a==b}"', 't"{a!=b}"', 't"{a:=1}"', 't"{(a:=1)}"', 't"{lambda: 1}"', 't"{lambda x: 1}"', 't"{(lambda: 1)}"', 't"{*a}"', 't"{**a}"', 't"{a;b}"', 't"{#}"', 't"{a#}"', 't"{\\n}"', 't"{a\\n}"', 't"{yield}"', 't"{await a}"', 't"{return}"', 't"{pass}"', 't"{a = 1}"', 't"{1 +}"', 't"{)}"', 't"{(}"', 't"{[}"', 't"{a]}"', 't"a" "b"', '"a" t"b"', 't"a" f"b"', 'f"a" t"b"', 't"a" b"b"', 'b"a" t"b"', 't"a" t"b"', 't"a" t"b" "c"', 'bt"a"', 'tb"a"', 'ft"a"', 'tf"a"', 'ut"a"', 'tu"a"', 'rt"a"', 'tr"a"', 'rtr"a"', 'tt"a"', 't "a"', 't"a', "t'a\nb'", 't"""a', 't"{a}" = 1', 't"a" += 1', 'del t"a"', 't"{a}".x', 't"{a}"[0]', 't"{a}"()', 'x = t"{a}", 1', 'f(t"{a}")', 't"{t"{a}"}"', 't"{f"{a}"}"', 'f"{t"{a}"}"', 't"\\N{nope}"', 't"\\x4"', 't"\\u12"', 't"\\777"', 't"\\d"', 'rt"\\"', 't"{a:\\}"', 't"{a!r:{b!s}}"', 't"{a:{b=}}"', 't"{a,}"', 't"{,}"', 't"{a:}}"', 't"{a}}"', 't"{{a}"', 't"{ {a} }"', 't"{{{a}}}"', 't"{a!r=}"', 't"{a=!}"', 't"{a:!r}"', 't = 1; t"a"', 't', 't.x', 't[0]', 't()', 'match x:\n case t"a": pass', 'def f(x=t"{a}"): pass', 'class C(t"a"): pass', 'import t', 'x: t"a" = 1', "t'{a!r:{b}}' t'{c}'", 't"{a:{b}{c}}"', 't"{a:x{b}y{c}z}"', 't"{\'a\' \'b\'}"', 't"{a if b else c}"', 't"{a if b}"', 't"{not a}"', 't"{a for a in b}"', 't"{[a for a in b]}"', 't"{a:=^10}"', 't"{a::}"', 't"{a:::}"', 't"{::}"', 't"{a[::2]}"', 't"{a[b:c]:d}"', 't"{{}"', 't"{}}"', 't"{!r}"', 't"{:x}"', 't"{=}"'):
    try: compile(src, "<s>", "exec"); print("ok:", src.replace("\n", "\\n"))
    except SyntaxError as e: print("SyntaxError:", e.msg, "<-", src.replace("\n", "\\n"))
