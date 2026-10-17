// `delete` of optional and nested fields through `any` and through optional chains.
const made = { a: { b: 1, c: 2 }, n: null }
const o: any = made
try { delete o.a?.b; console.log("delete o.a?.b: no error") } catch (e) { console.log("delete o.a?.b:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { delete o.a?.["c"]; console.log("delete o.a?.[c]: no error") } catch (e) { console.log("delete o.a?.[c]:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(JSON.stringify(o))
