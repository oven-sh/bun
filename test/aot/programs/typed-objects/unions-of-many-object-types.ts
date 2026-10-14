// A union of five or more object types, one of which has only primitive fields, receives parsed JSON and literals.
type Leaf = { tag: 0; v: number }
type Pair = { tag: 1; l: Term; r: Term }
type Triple = { tag: 2; a: Term; b: Term; c: Term }
type Neg = { tag: 3; of: Term }
type Named = { tag: 4; name: string; of: Term }
type List = { tag: 5; all: Term[] }
type Term = Leaf | Pair | Triple | Neg | Named | List
function evaluate(t: Term): number {
  switch (t.tag) {
    case 0: return t.v
    case 1: return evaluate(t.l) + evaluate(t.r)
    case 2: return evaluate(t.a) * evaluate(t.b) - evaluate(t.c)
    case 3: return -evaluate(t.of)
    case 4: return evaluate(t.of) + t.name.length
    case 5: { let n = 0; for (const e of t.all) n += evaluate(e); return n }
  }
}
function attempt(label: string, f: () => unknown) { try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) } }
attempt("plain data", () => { const parsed: Term = JSON.parse('{"tag":1,"l":{"tag":0,"v":4},"r":{"tag":3,"of":{"tag":4,"name":"ab","of":{"v":1,"tag":0}}}}'); return evaluate(parsed) })
attempt("plain data in a literal", () => { const parsed: Term = JSON.parse('{"tag":3,"of":{"tag":0,"v":7}}'); const made: Term = { tag: 2, a: { tag: 0, v: 2 }, b: parsed, c: { tag: 0, v: 1 } }; return evaluate(made) })
attempt("a literal through any", () => { const loose: any = { tag: 1, l: { tag: 0, v: 1 }, r: { tag: 3, of: { tag: 0, v: 2 } } }; return evaluate(loose) })
attempt("the flat part alone", () => { const leaves: Leaf[] = JSON.parse('[{"tag":0,"v":1},{"v":2,"tag":0}]'); return leaves.map(evaluate).join() + " " + Object.keys(leaves[1]).join() })
attempt("plain data with an array of the union", () => { const parsed: Term = JSON.parse('{"tag":5,"all":[{"tag":3,"of":{"v":1,"tag":0}},{"tag":0,"v":2}]}'); return evaluate(parsed) })
