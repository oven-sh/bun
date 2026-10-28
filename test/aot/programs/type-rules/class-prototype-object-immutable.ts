// The prototype object of a class of the program is never locked: members are added, redefined, replaced and deleted, and its prototype is changed, as in plain JavaScript. One row differs from plain Bun: `Reflect.set(proto, "tag", 1)` runs a setter whose parameter is written `string`, and a parameter is tested on entry, whoever calls.
function refused(label: string, f: () => unknown) { try { f(); console.log(label + ": no error") } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
class C { label = "x"; tag?: string; n?: number; method() { return "m" } }
function read(c: C): string { return String(c.tag) + "/" + String(c.n) + "/" + ("tag" in c) + "/" + Object.hasOwn(c, "tag") }
const list: C[] = [new C(), new C()]
try { list[1].tag = "own" } catch (e) { console.log("line 6:", e instanceof TypeError ? "TypeError" : "other " + e) }
const proto: any = Object.getPrototypeOf(list[0])
try { refused("property added", () => { proto.tag = "inherited" }) } catch (e) { console.log("line 8:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { refused("read-only property defined", () => Object.defineProperty(proto, "tag", { value: "ro", writable: false, configurable: true })) } catch (e) { console.log("line 9:", e instanceof TypeError ? "TypeError" : "other " + e) }
const log: string[] = []
try { refused("accessor defined", () => Object.defineProperty(proto, "tag", { get() { log.push("get"); return "got" }, set(v: string) { log.push("set " + v) }, configurable: true })) } catch (e) { console.log("line 11:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { refused("method replaced", () => { proto.method = () => "other" }) } catch (e) { console.log("line 12:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { refused("method deleted", () => { delete proto.method }) } catch (e) { console.log("line 13:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { refused("its prototype changed", () => Object.setPrototypeOf(proto, { n: 7 })) } catch (e) { console.log("line 14:", e instanceof TypeError ? "TypeError" : "other " + e) }
// By Reflect: the answers of plain JavaScript.
try { console.log(Reflect.set(proto, "tag", 1), Reflect.defineProperty(proto, "tag", { value: 1 }), Reflect.deleteProperty(proto, "method"), Reflect.setPrototypeOf(proto, null)) } catch (e) { console.log("line 16:", e instanceof TypeError ? "TypeError" : "other " + e) }
// Deleting an absent property is not an error, as in ECMAScript.
try { console.log(delete proto.tag, delete proto.n) } catch (e) { console.log("line 18:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { list[0].tag = "stored" } catch (e) { console.log("line 19:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(list.map(read).join(" "), read(new C()), "[" + log.join() + "]", list[0].method(), Object.getOwnPropertyNames(proto).join(), Object.isExtensible(proto)) } catch (e) { console.log("line 20:", e instanceof TypeError ? "TypeError" : "other " + e) }
