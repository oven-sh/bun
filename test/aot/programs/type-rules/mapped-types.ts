// Objects of mapped types such as `Record<"a" | "b" | "c", boolean>` are used as dictionaries.
type Flags3 = Record<"a" | "b" | "c", boolean>
const flags: Flags3 = { c: true, a: false, b: true }
const asDictionary: Record<string, boolean> = flags
asDictionary.d = true
try { delete asDictionary.b; console.log("a field, through the dictionary: no error") } catch (e) { console.log("a field, through the dictionary:", e instanceof TypeError ? "TypeError" : "other " + e) }
const key: string = "c"
try { delete asDictionary[key]; console.log("by a computed key: no error") } catch (e) { console.log("by a computed key:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { delete asDictionary.d; console.log("what the dictionary added: no error") } catch (e) { console.log("what the dictionary added:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(Object.keys(flags).join(), flags.a, flags.b, flags.c)
