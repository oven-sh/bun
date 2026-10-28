// `delete` of a field that is required in the type the object was created as succeeds, whichever way it is done, and the field reads `undefined` afterwards.
interface Author { nick: string; age?: number }
interface Doc { id: number; title?: string; pages?: number; author: Author; editor?: Author | null; refs: number[] }
function make(id: number): Doc { return { id, title: "t" + id, pages: id * 10, author: { nick: "a" + id }, editor: null, refs: [id] } }
function dropAny(o: any, k: string): boolean { return delete o[k] }
const three = make(4)
try { delete (three as { author?: Author }).author; console.log("through a type in which it is optional: no error") } catch (e) { console.log("through a type in which it is optional:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { dropAny(three, "refs"); console.log("through any, by key: no error") } catch (e) { console.log("through any, by key:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { dropAny(three, "id"); console.log("a number: no error") } catch (e) { console.log("a number:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { Reflect.deleteProperty(three, "author"); console.log("Reflect.deleteProperty: no error") } catch (e) { console.log("Reflect.deleteProperty:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(JSON.stringify(three), three.author.nick, three.refs.length, three.id) } catch (e) { console.log("line 12:", e instanceof TypeError ? "TypeError" : "other " + e) }
// Every key is deleted.
const six = make(8)
try { for (const k of Object.keys(six)) dropAny(six, k); console.log("all keys: no error") } catch (e) { console.log("all keys:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(Object.keys(six).join()) } catch (e) { console.log("line 16:", e instanceof TypeError ? "TypeError" : "other " + e) }
// An absent property is looked up on the prototype chain, and the prototype can be replaced.
const shelf: { title?: string; pages?: number } = {}
const five = make(6)
try { Object.setPrototypeOf(five, shelf); console.log("setPrototypeOf: no error") } catch (e) { console.log("setPrototypeOf:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(Object.getPrototypeOf(five) === Object.prototype) } catch (e) { console.log("line 21:", e instanceof TypeError ? "TypeError" : "other " + e) }
// Created with Object.create: any object passes the cast as it is, and the read goes up the chain.
const original = make(9)
try { const derived = Object.create(original) as Doc; console.log(derived.id); console.log("Object.create as Doc: no error") } catch (e) { console.log("Object.create as Doc:", e instanceof TypeError ? "TypeError" : "other " + e) }
// Classes: an own property in front of a method; the prototype gets properties by the names of fields.
class Page { num = 1; note?: string = "n"; next: Page | null = null; label() { return "p" + this.num + (this.note ?? "") } }
const page = new Page()
try { (page as any).label = () => "own label"; console.log("own property by the name of a method: no error") } catch (e) { console.log("own property by the name of a method:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { (Page.prototype as any).note = "N"; console.log("property added to the prototype of a class: no error") } catch (e) { console.log("property added to the prototype of a class:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { dropAny(page, "num"); console.log("required field of an instance: no error") } catch (e) { console.log("required field of an instance:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { delete (Page.prototype as any).label; console.log("method deleted from the prototype: no error") } catch (e) { console.log("method deleted from the prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(page.label(), Object.keys(page).join(), Object.keys(Page.prototype).length) } catch (e) { console.log("line 32:", e instanceof TypeError ? "TypeError" : "other " + e) }
// A constructor function with `this: T`, constructed through any.
function Leaf(this: Author, nick: string) { this.nick = nick; this.age = 1 }
try { const leaf: Author = new (Leaf as any)("leaf"); console.log(leaf.age); console.log("new (F as any)(): no error") } catch (e) { console.log("new (F as any)():", e instanceof TypeError ? "TypeError" : "other " + e) }
