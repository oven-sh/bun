// Loops that read the characters of a string held in a captured variable, while callees, callbacks, recursion, generators and the loop itself replace the string.
declare const console: { log(...args: unknown[]): void }
const wide = "ключ значение λ→∞ 𝒳𝒴 end", narrow = "alpha beta gamma delta epsilon"
function rope(a: string, b: string): string { return a + b }
function part(s: string, from: number, to: number): string { return ("<<" + s + ">>").slice(from + 2, to + 2) }
const texts: (() => string)[] = [() => narrow, () => wide, () => rope(narrow.slice(0, 11), wide.slice(5)), () => rope("x", "yz"), () => part(narrow, 6, 16), () => part(wide, 0, 13), () => "", () => "q", () => part(part(narrow, 2, 25), 3, 12)]
function createScanner(initial: string, onToken: ((kind: string) => void) | undefined) {
  let text = initial, pos = 0, end = initial.length, log = ""
  function setText(next: string): void { text = next; pos = 0; end = next.length }
  function isLetter(ch: number): boolean { return ch >= 97 && ch <= 122 || ch > 127 }
  function words(): string { let out = ""; while (pos < end) { const start = pos; while (pos < end && isLetter(text.charCodeAt(pos))) pos++; if (pos > start) out += text.substring(start, pos) + "/"; else pos++ } return out }
  function codePoints(): number { let sum = 0; for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.codePointAt(i)!) % 1000003; return sum }
  function characters(): string { let out = ""; for (let i = text.length - 1; i >= -1; i--) out += text.charAt(i) + (text[i] ?? "?") + (text.at(i) ?? "!"); return out }
  function pastTheEnd(): string { let out = ""; for (let i = -2; i < text.length + 2; i++) out += text.charCodeAt(i) + ","; return out }
  function replacedByCallee(next: string): string { let out = ""; pos = 0; while (pos < end) { out += text.charCodeAt(pos) + " "; if (pos === 2 && text !== next) setText(next); else pos++ } return out }
  function replacedByCallback(): string { let out = ""; pos = 0; while (pos < text.length) { const ch = text.charCodeAt(pos); out += ch + " "; pos++; if (ch === 32 && onToken) onToken("space") } return out }
  function replacedInTheLoop(all: string[]): string { let out = ""; for (let i = 0; i < all.length; i++) { text = all[i]; for (let j = 0; j < text.length; j += 3) out += text.charCodeAt(j) + "."; out += "|" } return out }
  function keepsTheOldString(next: string): string { let out = ""; for (let i = 0; i < 4; i++) { const before = text; if (i === 1) setText(next); out += before.charCodeAt(i) + ":" + text.charCodeAt(i) + ":" + before.length + ":" + text.length + " " } return out }
  function withHandler(): string { let out = ""; for (let i = 0; i < text.length + 1; i++) { try { if (i === 3) throw new Error("three"); out += text.charCodeAt(i) + " " } catch (e) { setText(text + "!"); out += (e as Error).message + " " } } return out }
  function nested(depth: number): string { let out = ""; for (let i = 0; i < text.length && i < 6; i++) { out += text.charCodeAt(i) + " "; if (i === 1 && depth > 0) { const saved = text; setText(saved.slice(1) + depth); out += "[" + nested(depth - 1) + "]"; setText(saved) } } return out }
  function usedAsKey(table: Record<string, number>): string { let out = ""; for (let i = 0; i < text.length && i < 8; i++) { table[text] = (table[text] ?? 0) + 1; out += text.charCodeAt(i) + "#" + table[text] + " "; log += "k" } return out }
  function* lazily(): Generator<number> { for (let i = 0; i < text.length; i++) yield text.charCodeAt(i) }
  async function slowly(): Promise<string> { let out = ""; for (let i = 0; i < text.length && i < 7; i++) { out += text.charCodeAt(i) + " "; await undefined; if (i === 2) setText(text.slice(1)) } return out }
  function lengths(): string { let out = ""; for (let i = 0; i < 5; i++) { out += text.length + " "; if (i === 2) setText(text + text) } return out }
  return { setText, words, codePoints, characters, pastTheEnd, replacedByCallee, replacedByCallback, replacedInTheLoop, keepsTheOldString, withHandler, nested, usedAsKey, lazily, slowly, lengths, log: () => log }
}
function createOptional(initial: string) {
  let text = initial, done = ""
  function put(next: string): void { text = next }
  function codes(turns: number, next: string): void { for (let i = 0; i < turns; i++) { done += text.charCodeAt(i) + ","; if (i === 1) put(next) } }
  function points(turns: number, next: string): void { for (let i = 0; i < turns; i++) { done += text.codePointAt(i) + ","; if (i === 1) put(next) } }
  function single(turns: number, next: string): void { for (let i = 0; i < turns; i++) { done += text.charAt(i) + ","; if (i === 1) put(next) } }
  function relative(turns: number, next: string): void { for (let i = 0; i < turns; i++) { done += text.at(-i) + ","; if (i === 1) put(next) } }
  function indexed(turns: number, next: string): void { for (let i = 0; i < turns; i++) { done += text[i] + ","; if (i === 1) put(next) } }
  function measured(turns: number, next: string): void { for (let i = 0; i < turns; i++) { done += text.length + ","; if (i === 1) put(next) } }
  return { put, all: [codes, points, single, relative, indexed, measured], take(): string { const was = done; done = ""; return was } }
}
function optional(): void {
  const values = new Array<string>(6)
  values[0] = "abc"; values[2] = (JSON.parse("[null]") as string[])[0]; values[3] = ""; values[4] = wide; values[5] = rope("r", "ope")
  for (const first of values) for (const next of values) for (const turns of [0, 1, 4]) {
    const held = createOptional(first)
    let row = String(first) + " " + String(next) + " " + turns + ":"
    for (const read of held.all) {
      held.put(first)
      try { read(turns, next); row += " ok " } catch (e) { row += " " + (e as Error).constructor.name + " " }
      row += held.take()
    }
    console.log(row)
  }
}
let noise = 0
function quiet(k: number): number { if (k > 1e9) return quiet(k - 1) + quiet(k - 2); return k & 3 }
function loud(k: number): number { if (k > 1e9) return loud(k - 1) + loud(k - 2); noise += k; return noise & 3 }
function createCalling(initial: string) {
  let text = initial
  let turn = 0
  function put(next: string): number { if (next.length > 1e9) return put(next + next); text = next; return next.length }
  function grow(k: number): number { if (k > 1e9) return grow(k - 1) + grow(k - 2); if (++turn % 3 === 0) text = text + "+" + k; return turn }
  function lengthsBehindQuietCalls(turns: number): number { let sum = 0; for (let i = 0; i < turns; i++) { sum += quiet(i); sum += text.length } return sum }
  function lengthsBehindLoudCalls(turns: number): number { let sum = 0; for (let i = 0; i < turns; i++) { sum += loud(i); sum += text.length } return sum }
  function codesBehindQuietCalls(turns: number): string { let row = ""; for (let i = 0; i < turns; i++) { row += quiet(i) + ":" + text.charCodeAt(i) + " " } return row }
  function codesBehindLoudCalls(turns: number): string { let row = ""; for (let i = 0; i < turns; i++) { row += loud(i) + ":" + text.charCodeAt(i) + ":" + text.length + " " } return row }
  function codesBehindCallsThatStore(turns: number): string { let row = ""; for (let i = 0; i < turns; i++) { row += grow(i) + ":" + text.charCodeAt(i) + ":" + text.codePointAt(text.length - 1) + ":" + text.length + " " } return row }
  function codesAheadOfCallsThatStore(turns: number): string { let row = ""; for (let i = 0; i < turns; i++) { row += text.charAt(i) + text.length + ":" + grow(i) + " " } return row }
  function codesAroundRareCalls(turns: number, next: string): string { let row = ""; for (let i = 0; i < turns; i++) { if (i === 2) row += "(" + put(next) + ")"; row += text.charCodeAt(i) + "," + text.at(-1) + " " } return row }
  return { put, lengthsBehindQuietCalls, lengthsBehindLoudCalls, codesBehindQuietCalls, codesBehindLoudCalls, codesBehindCallsThatStore, codesAheadOfCallsThatStore, codesAroundRareCalls }
}
function calling(): void {
  for (const make of texts) {
    const held = createCalling(make())
    console.log(held.lengthsBehindQuietCalls(5), held.lengthsBehindLoudCalls(5), held.codesBehindQuietCalls(5), held.codesBehindLoudCalls(5))
    console.log(held.codesBehindCallsThatStore(8)); held.put(make())
    console.log(held.codesAheadOfCallsThatStore(8)); held.put(make())
    for (const other of texts) { console.log(held.codesAroundRareCalls(5, other())); held.put(make()) }
  }
}
async function main(): Promise<void> {
  optional()
  calling()
  for (let a = 0; a < texts.length; a++) {
    let turns = 0
    const scanner = createScanner(texts[a](), kind => { if (++turns === 2) scanner.setText(texts[(a + 3) % texts.length]() + " " + kind) })
    const fresh = () => scanner.setText(texts[a]())
    console.log("== " + a)
    console.log(scanner.words()); fresh()
    console.log(scanner.codePoints()); fresh()
    console.log(scanner.characters()); fresh()
    console.log(scanner.pastTheEnd()); fresh()
    for (let b = 0; b < texts.length; b++) { console.log(scanner.replacedByCallee(texts[b]())); fresh(); console.log(scanner.keepsTheOldString(texts[b]())); fresh() }
    console.log(scanner.replacedByCallback()); fresh()
    console.log(scanner.replacedInTheLoop(texts.map(make => make()))); fresh()
    console.log(scanner.withHandler()); fresh()
    console.log(scanner.nested(3)); fresh()
    console.log(scanner.usedAsKey({})); fresh()
    let seen = ""; for (const ch of scanner.lazily()) { seen += ch + " "; if (seen.length === 20) scanner.setText("swapped") } console.log(seen); fresh()
    console.log(await scanner.slowly()); fresh()
    console.log(scanner.lengths(), scanner.log().length)
  }
  const scanner = createScanner("", undefined)
  let total = 0
  for (let round = 0; round < 3000; round++) { scanner.setText(rope("word" + round + " ", part(narrow, round % 7, 20)) + (round % 5 ? "" : " ж")); total += scanner.words().length + scanner.codePoints() % 7 }
  console.log(total)
}
main()
