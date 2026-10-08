var street = user.address?.street
var fooValue = myForm.querySelector('input[name=foo]')?.value

obj?.prop;
obj?.[expr];
func?.(...args);

a?.();
a?.[++x];
a?.b.c(++x).d;
a?.b[3].c?.(x).d;
a?.b.c;
(a?.b).c;
a?.b?.c;
delete a?.b;

a?.b[3].c?.(x).d.e?.f[3].g?.(y).h;

(a?.b).c();
(a?.b[c]).c();

(a?.b)?.c.d?.e;
(a ? b : c)?.d;

(list || list2)?.length;
(list || list2)?.[(list || list2)];

async function HelloWorld() {
  var x = (await foo.bar.blah)?.hi;
  a?.[await b];
  (await x)?.();
}

a[b?.c].d();
a?.[b?.c].d();
a[b?.c]?.d();
a?.[b?.c]?.d();

(one?.fn());
(one?.two).fn();
(one?.two)();
(one?.two())();
(one.two?.fn());
(one.two?.three).fn();
(one.two?.three?.fn());

(one?.());
(one?.())();
(one?.())?.();

(one?.()).two;

a?.[b ? c : d];

(-1)?.toFixed();
(void fn)?.();
(a && b)?.();
(a ? b : c)?.();
(function(){})?.();
(() => f)?.();
(()=>f)?.x;
(a?.(x)).x;
(aaaaaaaaaaaaaaaaaaaaaaaa&&aaaaaaaaaaaaaaaaaaaaaaaa&&aaaaaaaaaaaaaaaaaaaaaaaa)?.();

let f = () => ({}?.());
let g = () => ({}?.b);
a = () => ({}?.() && a);
a = () => ({}?.()() && a);
a = () => ({}?.().b && a);
a = () => ({}?.b && a);
a = () => ({}?.b() && a);
(a) => ({}?.()?.b && 0);
(a) => ({}?.b?.b && 0);
(x) => ({}?.()());
(x) => ({}?.().b);
(x) => ({}?.b());
(x) => ({}?.b.b);
({}?.a().b());
({ a: 1 }?.entries());

new (foo?.bar)();
new (foo?.bar())();
new (foo?.())();
