// Optional chains: the `ChainExpression` and the element in it have the same range.
const f1 = () => a?.b({ c });
const f2 = () => a?.b!;
const f3 = () => (a?.b).c({ d });
const f4 = () => ({ a })?.b;
a?.b
a?.[b](c)
a?.b!.c
a?.b!
;(a?.b)!
;(a?.b)(c)
;(a?.b).c
;(a?.b)`c`
!a?.b
delete a?.b
delete a?.b!
a?.b + a?.b
a?.b.c === a?.b.c
a.b.c === a.b.c
a[b] === a.b
a.#b === a.#b
a?.filter(x => x)
;(a?.filter)(x => x)
a.b?.every(x => x)
Promise?.all([])
Promise.all?.([])
await a?.b
void a?.b()
new (a?.b)()
typeof a?.b
a?.b ? a?.c : a?.d
x = a?.b
for (const k of a?.b) k
`${a?.b}`
