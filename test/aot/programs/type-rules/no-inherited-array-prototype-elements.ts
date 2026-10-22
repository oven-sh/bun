// `Array.prototype` takes no index, so holes and out-of-bounds reads never find an inherited element. An ordinary new name can be added to it and deleted again, as in plain Bun.
const protoAny: any = Array.prototype
try { protoAny[1] = "inherited"; console.log("an element added to Array.prototype: no error") } catch (e) { console.log("an element added to Array.prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(String(([0, , 2] as unknown[])[1]), String(([0] as unknown[])[1]), 1 in [0])
console.log(delete protoAny[1], 1 in [0])
try { protoAny.extra = "added"; console.log("a name added to Array.prototype: no error", ([] as any).extra) } catch (e) { console.log("a name added to Array.prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(delete protoAny.extra, "extra" in [])
