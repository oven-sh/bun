// A value read by name from what has no type goes at once to where a type is asked of it. Where the TypeError is thrown, by line and column, and where an error thrown inside the read is.
const body: any = JSON.parse('{"n":"wrong","t":5,"f":"no","list":7}')
const thrower: any = { get n(): number { throw new RangeError("inside the read") } }
function place(error: unknown): string {
  const e = error as Error
  return e.name + ": " + e.message.split("\n")[0].replace(/ \(bun compile[^)]*\)/, "") + " | " + (e.stack ?? "").split("\n").map(line => /:(\d+:\d+)\)?\s*$/.exec(line)).filter(found => found !== null).slice(0, 3).map(found => found![1]).join(" < ")
}
function row(name: string, f: () => unknown) { try { console.log(name, "|", String(f())) } catch (error) { console.log(name, "|", place(error)) } }
function takes(n: number): number { return n + 1 }
function takesTwo(t: string, n: number): string { return t + n }
function takesMaybe(n?: number): number { return n === undefined ? -1 : n }
class Account { total = 0; constructor(public opening: number) {} add(n: number): number { return this.total += n } static parse(t: string): string { return "parsed " + t } set level(n: number) { this.total = n } }
function yieldsText(): string { return body.t }
function yieldsFlag(): boolean { return body.f }
const arrow = (n: number): number => n * 2
for (let round = 0; round < 2; round++) {
  row("a variable", () => { const n: number = body.n; return n })
  row("a variable, over lines", () => {
    const n: number =
      body
        .n
    return n
  })
  row("an argument", () => takes(body.n))
  row("the second argument", () => takesTwo("a", body.n))
  row("the first argument", () => takesTwo(body.t, 1))
  row("an argument, over lines", () => takes(
    body.n,
  ))
  row("an optional parameter", () => takesMaybe(body.n))
  row("an arrow function", () => arrow(body.n))
  row("a constructor", () => new Account(body.n).opening)
  row("a method", () => new Account(1).add(body.n))
  row("a static method", () => Account.parse(body.t))
  row("a setter", () => { const account = new Account(1); account.level = body.n; return account.total })
  row("a result", yieldsText)
  row("another result", yieldsFlag)
  row("a member of a literal", () => { const o: { a: number; b: string } = { a: body.n, b: "b" }; return o.a })
  row("an element of a literal", () => { const list: number[] = [1, body.n]; return list.length })
  row("a written cast", () => { try { return (body.n as number) + 1 } catch (error) { return (error as Error).name } })
  row("an assignment", () => { let t = "t"; t = body.t; return t })
  row("inside the read", () => { const n: number = thrower.n; return n })
  row("inside the read of an argument", () => takes(thrower.n))
  row("what fits", () => { const t: number = body.t; const n: string = body.n; return takes(body.t) + t + n })
}
