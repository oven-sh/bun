// `for..in` over values of type `any`: strings, numbers, objects, null, undefined and booleans.
function keysOfAny(o: any): string { const out: string[] = []; for (const k in o) out.push(k); return out.join("") }
console.log(keysOfAny("ab"), keysOfAny(5), keysOfAny({ x: 1 }), keysOfAny(null), keysOfAny(undefined), keysOfAny(true), keysOfAny(Symbol("s")), keysOfAny(10n))
