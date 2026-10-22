// Array elements are not trusted. An element read, an iteration or a pattern on an array whose element type is written (an annotation, a parameter, an `as` on the spot) is tested where it reads. An unannotated variable has an inferred type (`texts`, `mixed`, the tuple `pair`), and what `Map.get`, `pop` or `at` returns is a prediction: these are tested where the value enters a written type.
/* expected
a1 2
a2 a
a2t TypeError
a3 undefined
a3b undefined
a4 0ab
a5 a,b
a6 a
a7 a
b1 1
b2 b
b2t TypeError
b3 3
c1 2
c2 TypeError
c2t TypeError
c3 three
c4 3
c5 1,2,three
d1 v
d1t TypeError
d2 undefined
d3 true
d4 v
e1 a
e2 2
e3 b
f1 1
f2 x
f2t TypeError
g1 TypeError
g1t TypeError
g2 TypeError
g3 undefined
g4 TypeError
h1 z
h1t TypeError
h2 9
h3 z
h3t TypeError
i1 TypeError
i2 1
*/
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
const texts = JSON.parse('["a","b"]') as number[]
attempt("a1", () => texts.length)
attempt("a2", () => texts[0])
attempt("a2t", () => { const n: number = texts[0]; return n })
attempt("a3", () => texts[5])
attempt("a3b", () => { const n: number = texts[5]; return n })
attempt("a4", () => { let s = 0; for (const n of texts) s += n; return s })
attempt("a5", () => texts.join())
attempt("a6", () => (texts as unknown[])[0])
attempt("a7", () => (texts as any)[0])
const mixed = JSON.parse('[1,"b",3]') as number[]
attempt("b1", () => mixed[0])
attempt("b2", () => mixed[1])
attempt("b2t", () => { const n: number = mixed[1]; return n })
attempt("b3", () => mixed[2])
// No cast and no any: arrays are covariant in TypeScript.
const nums: number[] = [1, 2]
const wide: (number | string)[] = nums
wide.push("three")
attempt("c1", () => nums[1])
attempt("c2", () => nums[2])
attempt("c2t", () => { const n: number = nums[2]; return n })
attempt("c3", () => wide[2])
attempt("c4", () => nums.length)
attempt("c5", () => nums.join())
const byKey = new Map<string, number>()
;(byKey as Map<string, any>).set("k", "v")
attempt("d1", () => byKey.get("k"))
attempt("d1t", () => { const n: number | undefined = byKey.get("k"); return n })
attempt("d2", () => byKey.get("none"))
attempt("d3", () => byKey.has("k"))
attempt("d4", () => (byKey as Map<string, unknown>).get("k"))
attempt("e1", () => { const [first] = texts; return first })
attempt("e2", () => [...texts].length)
attempt("e3", () => { const [, second] = mixed; return second })
const pair = JSON.parse('[1,"x"]') as [number, number]
attempt("f1", () => pair[0])
attempt("f2", () => pair[1])
attempt("f2t", () => { const n: number = pair[1]; return n })
attempt("g1", () => (JSON.parse("[1]") as string[])[0])
attempt("g1t", () => { const s: string = (JSON.parse("[1]") as string[])[0]; return s })
attempt("g2", () => typeof (JSON.parse("[1]") as { x: number }[])[0])
attempt("g3", () => (JSON.parse('[{"y":1}]') as { x?: number }[])[0].x)
attempt("g4", () => (JSON.parse("[1]") as boolean[])[0] ? "t" : "f")
attempt("h1", () => (JSON.parse('["z"]') as number[]).pop())
attempt("h1t", () => { const n: number | undefined = (JSON.parse('["z"]') as number[]).pop(); return n })
attempt("h2", () => (JSON.parse("[9]") as number[]).pop())
attempt("h3", () => (JSON.parse('["z"]') as number[]).at(0))
attempt("h3t", () => { const n: number | undefined = (JSON.parse('["z"]') as number[]).at(0); return n })
// An index loop over doubles that meets a string half way.
function total(a: number[]): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s }
attempt("i1", () => total(JSON.parse('[0.5,1.5,"2"]')))
attempt("i2", () => total(JSON.parse("[0.25,0.75]")))
