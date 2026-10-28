// `delete` of a field that is required in the type the object was created as succeeds: through a type in which the field is optional, through `any` and by `Reflect.deleteProperty`.
interface Author { nick: string; age?: number }
interface Doc { id: number; title?: string; author: Author; refs: number[] }
function make(id: number): Doc { return { id, title: "t" + id, author: { nick: "a" + id }, refs: [id] } }
function dropAny(o: any, k: string): boolean { return delete o[k] }
const three = make(4)
// Through a view in which the field is optional: no `any`, and the checker has nothing against it.
try { delete (three as { author?: Author }).author; console.log("required field deleted through a view where it is optional: no error") } catch (e) { console.log("required field deleted through a view where it is optional:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { dropAny(three, "refs"); console.log("required field deleted through any: no error") } catch (e) { console.log("required field deleted through any:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { dropAny(three, "id"); console.log("required number deleted through any: no error") } catch (e) { console.log("required number deleted through any:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(Reflect.deleteProperty(three, "id")); console.log("the same by Reflect.deleteProperty: no error") } catch (e) { console.log("the same by Reflect.deleteProperty:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(JSON.stringify(three), Object.getOwnPropertyDescriptor(three, "id")!.configurable) } catch (e) { console.log("line 12:", e instanceof TypeError ? "TypeError" : "other " + e) }
// Every key is deleted, the last one first.
const six = make(8)
try { for (const k of Object.keys(six).reverse()) dropAny(six, k); console.log("all fields deleted: no error") } catch (e) { console.log("all fields deleted:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(JSON.stringify(six)) } catch (e) { console.log("line 16:", e instanceof TypeError ? "TypeError" : "other " + e) }
class Page { num = 1; label() { return "p" + this.num } }
const page = new Page()
try { (page as any).label = () => "own label"; console.log("own property named like a method: no error") } catch (e) { console.log("own property named like a method:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(page.label(), delete (page as any).label, page.label(), Object.keys(page).join()) } catch (e) { console.log("line 21:", e instanceof TypeError ? "TypeError" : "other " + e) }
