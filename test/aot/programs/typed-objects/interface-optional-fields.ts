// Optional and nullable fields of interfaces are added, set to null, deleted and read.
interface Author { nick: string; age?: number }
interface Doc { id: number; title?: string; author: Author; editor?: Author | null; refs: number[] }
function make(id: number): Doc { return { id, title: "t" + id, author: { nick: "a" + id }, editor: null, refs: [id] } }
const states = [make(2), make(2), make(2), make(2)]
console.log(Object.keys(states[1]).join())
states[0].editor = undefined; states[1].editor = null; delete states[2].editor; states[3].editor = { nick: "ed" }
console.log(states.map(d => Object.keys(d).join()).join(" "))
