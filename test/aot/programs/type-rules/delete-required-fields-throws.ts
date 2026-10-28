// `delete` of required fields through a receiver of type `any`, by name and by a computed key, on literals and on an instance of a class, works as in JavaScript.
function normalize(given: any) {
  const params = given
  if (!params) return {}
  if (params?.message !== undefined) params.error = params.message
  delete params.message
  return params
}
function byKey(o: any, k: string) { delete o[k]; return o }
class Box { width = 1; height = 2; label = "b"; area() { return this.width * this.height } }
const a = { message: "m", error: undefined as string | undefined, code: 7 }
const b = { message: "n", code: 8.5, nested: { message: "inner", keep: true } }
try { normalize(a); console.log("by name: no error") } catch (e) { console.log("by name:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(JSON.stringify(a), "message" in a, a.message, Object.keys(a).join(), a.code + 1)
try { normalize(b); console.log("by name, after an extra property: no error") } catch (e) { console.log("by name, after an extra property:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { normalize(b.nested); console.log("by name, nested: no error") } catch (e) { console.log("by name, nested:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(JSON.stringify(b), b.code * 2, b.nested.keep)
const box = new Box()
try { byKey(box, "height"); console.log("by key: no error") } catch (e) { console.log("by key:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(JSON.stringify(box), box.area(), box.height, Object.hasOwn(box, "height"), box.label.length)
try { Reflect.deleteProperty(box, "label"); console.log("Reflect.deleteProperty: no error") } catch (e) { console.log("Reflect.deleteProperty:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(box.label, Object.keys(box).join())
