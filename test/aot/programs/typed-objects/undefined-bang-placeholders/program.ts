interface SourceFile { fileName: string; text: string; statements: Stmt[] }
interface Stmt { kind: number; pos: number }
interface Scanner { setText(text: string): void; scan(): number; getPos(): number }
let currentFile: SourceFile = undefined!
let currentText: string = undefined!
let position: number = -1
let isStrict: boolean = false
let scanner: Scanner = null!
function describe(): string {
  return [typeof currentFile, typeof currentText, typeof position, typeof isStrict, String(scanner), String(position), String(currentText)].join()
}
console.log(describe())
function createScanner(): Scanner {
  let text: string = undefined!
  let pos: number = -1
  return {
    setText(t) { text = t; pos = 0 },
    scan() { return pos < text.length ? text.charCodeAt(pos++) : -1 },
    getPos() { return pos },
  }
}
function parse(fileName: string, text: string): SourceFile {
  scanner = createScanner()
  const early = String(scanner.getPos())
  scanner.setText(text)
  currentText = text; position = 0; isStrict = text.startsWith("s")
  currentFile = { fileName, text, statements: [] }
  for (let c = scanner.scan(); c !== -1; c = scanner.scan()) { currentFile.statements.push({ kind: c, pos: position }); position = scanner.getPos() }
  const result = currentFile
  console.log(early, describe())
  // Cleared again, as the parser does, so that nothing is kept alive.
  currentFile = undefined!; currentText = undefined!; position = -1; isStrict = false; scanner = undefined!
  return result
}
const parsed = parse("a.ts", "sab")
console.log(JSON.stringify(parsed), describe())
try { console.log(currentFile.fileName) } catch (e) { console.log((e as Error).constructor.name) }
try { console.log(currentText.length) } catch (e) { console.log((e as Error).constructor.name) }
console.log(position + 1, isStrict ? "strict" : "sloppy", currentText === undefined, currentText + "!")
// Fields and parameters.
class Binder {
  file: SourceFile = undefined!
  container: Stmt = undefined!
  count: number = -1
  label: string = null!
  bind(file: SourceFile) { this.file = file; this.container = file.statements[0]; this.count = file.statements.length; this.label = file.fileName; return this }
  state() { return [Object.keys(this).join(), String(this.count), String(this.label), typeof this.file, typeof this.container, JSON.stringify(this)].join(" ") }
}
const binder = new Binder()
console.log(binder.state())
console.log(binder.count + 1, binder.label + "!", "label" in binder, "file" in binder, binder.file === undefined, binder.label === null)
console.log(binder.bind(parsed).state())
console.log(binder.count + 1, binder.label + "!", binder.container.kind)
interface Links { target: Stmt; type: string; id: number }
function emptyLinks(): Links { return { target: undefined!, type: undefined!, id: 0 } }
const links = emptyLinks()
console.log(Object.keys(links).join(), JSON.stringify(links), String(links.id), String(links.type), String(links.target), links.id + 1, "type" in links)
links.id = 3; links.type = "t"; links.target = parsed.statements[1]
console.log(Object.keys(links).join(), JSON.stringify(links), links.id + 1, links.type + "!", links.target.pos)
function visit(node: Stmt = undefined!, depth: number = 0): string { return String(node) + String(depth) }
console.log(visit(), visit(undefined, 1))
const table: Stmt[] = [undefined!, { kind: 1, pos: 2 }]
console.log(table.length, String(table[0]), table[1].kind, JSON.stringify(table))
