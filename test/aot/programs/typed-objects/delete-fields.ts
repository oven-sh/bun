// `delete` of optional fields of typed objects: through the type, through `any`, with `Reflect` and with computed keys.
interface Author { nick: string; age?: number }
interface Doc { id: number; title?: string; pages?: number; draft?: boolean; author: Author; editor?: Author | null; refs: number[] }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function make(id: number): Doc { return { id, title: "t" + id, pages: id * 10, draft: false, author: { nick: "a" + id }, editor: null, refs: [id] } }
function show(d: Doc): string {
  return [String(d.title), String(d.pages), String(d.draft), d.author ? d.author.nick : String(d.author), d.editor ? d.editor.nick : String(d.editor), d.refs ? d.refs.length : "no refs",
    ["title", "pages", "draft", "author", "editor"].map(k => k in d ? "1" : "0").join(""), Object.keys(d).join(",")].join("/")
}
const one = make(1)
console.log(show(one))
console.log(delete one.pages, delete one.pages, show(one), (one.pages ?? 0) + 1, one.pages === undefined, Object.hasOwn(one, "pages"))
one.pages = 7
console.log(show(one), JSON.stringify(one))
// Absent, undefined and null are three states.
const states = [make(2), make(2), make(2), make(2)]
states[0].editor = undefined; states[1].editor = null; delete states[2].editor; states[3].editor = { nick: "ed" }
states[0].draft = undefined; delete states[2].draft; states[0].title = undefined; states[1].title = ""; delete states[2].title
console.log(states.map(d => show(d)).join(" "))
console.log(states.map(d => JSON.stringify(d)).join(" "))
console.log(states.map(d => [d.editor === null, d.editor === undefined, d.editor == null, "editor" in d, d.draft === false, d.title ?? "?", d.title || "!"].join("")).join(" "))
// The same through `any`, Reflect, a computed key and a narrower view.
function dropAny(o: any, k: string): boolean { return delete o[k] }
function dropTitle(o: { title?: string }): boolean { return delete o.title }
const two = make(3)
console.log(dropAny(two, "draft"), Reflect.deleteProperty(two, "pages"), dropTitle(two), dropAny(two, "nothing"), show(two))
two.title = "back"; two.draft = true; two.pages = 1
console.log(show(two), two.title.length + two.pages)
// An optional field of an object in a required field.
const three = make(4)
three.author = { nick: "again", age: 3 }
three.refs = []
console.log(show(three), three.author.age, delete three.author.age, Object.keys(three.author).join(), "age" in three.author)
// Delete and store in a loop over objects of one layout; only some lose the field.
const many: Doc[] = []
for (let i = 0; i < 30; i++) many.push(make(i))
let sum = 0
for (let round = 0; round < 6; round++) for (let i = 0; i < many.length; i++) {
  const d = many[i]
  if ((i + round) % 3 === 0) delete d.pages; else if ((i + round) % 3 === 1) d.pages = (d.pages ?? 100) + round
  if ((i + round) % 5 === 0) delete d.title; else if (d.title === undefined) d.title = "r" + round
  sum += (d.pages ?? -1) + (d.title ? d.title.length : 0) + d.id
}
console.log(sum, many.map(d => Object.keys(d).indexOf("pages")).join(""), many.filter(d => "title" in d).length)
// Classes: an own optional field.
class Page { num = 1; note?: string = "n"; next: Page | null = null; label() { return "p" + this.num + (this.note ?? "") } }
const page = new Page()
delete page.note
console.log(page.label(), Object.keys(page).join(), new Page().label(), "note" in page)
page.note = "late"
console.log(page.label(), Object.keys(page).join())
