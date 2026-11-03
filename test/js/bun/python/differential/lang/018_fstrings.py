def t(src, **env):
    try:
        print(repr(eval(src, env)))
    except SyntaxError as e:
        print("SyntaxError:", e.msg)
    except Exception as e:
        print(type(e).__name__ + ':', e)

x = 5; y = "str"; z = 3.14159; l = [1, 2, 3]; d = {"a": 1, "b c": 2}
print(f"", f"a", f"{x}", f"a{x}b", f"{x}{y}", f"{x} {y} {z}", f"{{}}", f"{{{x}}}", f"{{x}}", f"{x}}}", f"{{{{", f"{x!r}", f"{y!r}", f"{y!s}", f"{y!a}", f"{'é'!a}", f"{x:5}|", f"{x:<5}|", f"{x:05}", f"{y:>6}", f"{y:^7}|", f"{z:.2f}", f"{z:8.3f}|", f"{x:x}", f"{255:#x}", f"{x:+}", f"{1000000:,}", f"{y!r:>8}", f"{z!s:.3}")
print(f"{x + 1}", f"{x * 2 + 1}", f"{x == 5}", f"{x != 5}", f"{x >= 5}", f"{x if x > 3 else 0}", f"{l[0]}", f"{l[1:]}", f"{d['a']}", f"{d["a"]}", f"{d['b c']}", f"{len(l)}", f"{y.upper()}", f"{', '.join(str(i) for i in l)}", f"{[i * 2 for i in l]}", f"{ {1: 2} }", f"{ {1, 2} }", f"{(1, 2)}", f"{1, 2}", f"{(lambda a: a + 1)(1)}", f"{x!r:>{x}}", f"{not x}", f"{-x}", f"{x ** 2}", f"{x // 2}", f"{x % 2}", f"{x and y}", f"{None}", f"{True}", f"{...}", f"{x:}")
w = 10; p = 3; fill = "*"; align = "^"
print(f"{z:{w}.{p}f}|", f"{z:{w}}|", f"{y:{fill}{align}{w}}|", f"{x:{'0'}{w}}", f"{z:.{p}}", f"{x:{w}d}|", f"{x:{w + 1}}|", f"{y:{'>' if x else '<'}{w}}|", f"{x:{f'{w}'}}|", f"{z:{w}.{p}{'f'}}|", f"{x:{w}{'x'}}|")
print(f"{x=}", f"{x = }", f"{x =}", f"{x= }", f"{y=}", f"{y=!s}", f"{y=!r}", f"{z=:.2f}", f"{x + 1=}", f"{x+1 = }", f"{l[0]=}", f"{d['a']=}", f"{y.upper()=}", f"{x=:5}|", f"{x=:>5}|", f"{x = :05}", f"{(x, y)=}", f"{x,y=}", f"{ x = }", f"{x=!r:>4}", f"{'a' 'b'=}", f"{x  ==  5=}", f"{x # c
=}" if False else "", f"{f'{x}'=}")
print(f"{'nested'}", f"{"same quotes"}", f"{f'{x}'}", f"{f"{f"{x}"}"}", f"{f'{f"{x + 1}"}'}", f"{'a' + f'{x}' + 'b'}", f"{'\n'!r}", f"{'\\'}", f"{"\t"!r}", f"a\nb{x}\tc", f"\{x}" if False else "", f"{x}\\", f"\x41{x}\101", f"\N{BULLET}{x}", f"{'\N{BULLET}'}", rf"\n{x}\t", fr"{x}\\", Rf"\{x}", f"{x:\x3e4}", rf"{x:\>4}" if False else "")
print(f"""multi
line {x}
end""", f'''{x}
{y}''', f"""{
    x
}""", f"{x
}", f"{
x:5}|", f"""{x:
}""" if False else "", f"""a{'''b'''}c""", f"{'''a
b'''!r}")
print("a" f"{x}" "b", f"{x}" "c", "d" f"{x}", f"{x}" f"{y}", "{x}" f"{x}", f"{x}" "{x}", r"\n" f"\n{x}" == "\\n\n5", "a" "b" f"{x}" "c" "d", ("p" f"{x}"
  f"{y}" "q"))
print(f"{x:{{}}}" if False else "", f"{'{'}", f"{'}'}", f"{'{}'}", f"{'{x}'}", f"{{{'x'}}}", f"{ {'a': 1}['a'] }", f"{ {'a': {'b': 2}}['a']['b'] }", f"{ {x} }", f"{ {x: y} }", f"{[{1: 2}]}", f"{({1: 2},)}")
print(f"{x:!<4}", f"{x:=^5}" , f"{x!s:=^5}", f"{x!=6}", f"{x != 6}", f"{x!r}", f"{(x!=6)!r}", f"{x<6}", f"{x>4}", f"{x:>4}", f"{x:=4}", f"{(y:=7)}", y, f"{x:=>4}", f"{x::>4}", f"{x:::}" if False else "")
y = "str"
class C:
    def __format__(self, spec): return f"C[{spec}]"
    def __repr__(self): return "C()"
    def __str__(self): return "C-str"
c = C()
print(f"{c}", f"{c:}", f"{c:abc}", f"{c:{x}}", f"{c:a{x}b{y}c}", f"{c!r}", f"{c!s}", f"{c!s:>7}", f"{c=}", f"{c=:x}", f"{c=!s}", f"{c:{{}}}" if False else "", f"{c:!r}", f"{c: }", f"{c:  a  }", f"{c:a:b}", f"{c:[0]}", f"{c:%Y-%m}", f"{c:\n}", f"{c:'\"}", f"{c:{'}'}}", f"{c:{"{"}}")
def gen():
    yield f"{(yield 1)}"
g = gen(); print(next(g), g.send("sent"))
print(f"{(lambda: x)()}", f"{(lambda x: x * 2)(4)}", f"{(lambda: {'a': 1})()['a']}", [f"{i}{j}" for i in "ab" for j in "12"], {f"k{i}": f"v{i}" for i in range(2)}, f"{[f'{i}' for i in range(3)]}", f"{sum(i for i in range(4))}", f"{x if True else y:>3}", f"{*l,}", f"{[*l, *l]}", f"{ {**d} }")
print(len(f"{'a' * 1000}"), f"{'':>3}|", f"{'':3}|", f"{1}{2}{3}{4}{5}{6}{7}{8}{9}{10}", f"{x}" * 3, f"{x}"[0], f"{x}{y}".upper(), f"{x}" + "a", f"{x}" == "5", f"{x}" in "456", type(f"{x}"), type(f""), f"{1_000}", f"{0x10}", f"{1e3}", f"{1j}", f"{b'a'}", f"{'a' 'b'}", f"{'a'
'b'}")
for src in ('f"{"', 'f"}"', 'f"{}"', 'f"{ }"', 'f"{x"', 'f"{x!}"', 'f"{x!z}"', 'f"{x!r"', 'f"{x!rr}"', 'f"{x! r}"', 'f"{x!r :}"', 'f"{!r}"', 'f"{:5}"', 'f"{=}"', 'f"{x:{}}"', 'f"{x:{y:{z:{w}}}}"', 'f"{x y}"', 'f"{x +}"', 'f"{a b}"', 'f"{lambda x: 1}"', 'f"{x:{"', 'f"{x}}"', 'f"{{x}"', 'f"{x:}}"', 'f"{1 +}"', 'f"{(}"', 'f"{)}"', 'f"{[}"', 'f"{x!s!r}"', 'f"{x=!}"', 'f"{\\}"', 'f"{x\\}"', "f'{x", "f'''{x", 'f"{x:', 'f"{*x}"', 'f"{**x}"', 'f"{yield}"', 'f"{await x}"', 'f"{x = y}"', 'f"{x := 1}"', 'f"{import os}"', 'f"{pass}"', 'f"{#}"', 'f"{x#}"', 'bf"{x}"', 'fb"{x}"', 'uf"{x}"', 'f"{x}" b"a"', 'b"a" f"{x}"', 'f"{x.}"', 'f"{x..y}"', 'f"{0x}"', 'f"{1__0}"', "f'{'", 'f"{x!r=}"', 'f"{del x}"', 'f"{\'a\' \'b\' :}"'):
    t(src, x=1, y=2, z=3, w=4)
t('f"{nope}"')
t('f"{x.nope}"', x=1)
t('f"{x[5]}"', x=[1])
t('f"{x:z}"', x=1)
t('f"{x:d}"', x="a")
t('f"{1/0}"')
t('f"{x:{y}}"', x=1, y="q")
t('f"{x!r:d}"', x=1)
