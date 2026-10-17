// A string field compared with string literals (`===`, `switch`) answers the same however the string was made (joined, sliced, parsed, decoded) and however it was stored.
type Block = { kind: string; text: string; note?: string; n: number };
type Other = { kind: "a" | "b"; label: string };
class Holder { kind: string; text = ""; constructor(kind: string) { this.kind = kind; } add(more: string) { this.text += more; return this; } }
const say = (what: string, got: unknown) => console.log(what + ": " + (typeof got === "string" ? got : JSON.stringify(got) ?? String(got)));
function which(b: Block): string {
  let s = "";
  if (b.kind === "text") s += "T"; if (b.kind !== "text") s += "t"; if (b.kind == "image") s += "I"; if (b.kind != "image") s += "i"; if ("tool_use" === b.kind) s += "U";
  if (b.kind === "text" || b.kind === "image" || b.kind === "tool_use") s += "3";
  if (b.kind === "") s += "E";
  if (b.kind === "0123456789012345678901234567890123456789") s += "F";
  if (b.kind === "01234567890123456789012345678901234567890") s += "G";
  switch (b.kind) { case "text": s += "1"; break; case "image": s += "2"; break; case "tool_use": s += "3"; break; case "tool_result": s += "4"; break; default: s += "0"; }
  const { kind } = b; if (kind === "text") s += "D";
  const k = b.kind; s += k === "text" ? "L" : k === "image" ? "M" : "N";
  return s;
}
const isText = (kind: string) => kind === "text"; const isNote = (b: Block) => b.note === "yes" || b.note === undefined;
const textIs = (b: Block) => (b.text === "" ? "empty" : b.text === "text" ? "the word" : "other " + b.text.length);
const half = (s: string) => s.slice(0, s.length / 2);
const makers: [string, () => string][] = [
  ["spelled out", () => "text"], ["joined", () => "te" + half("xtxt")], ["in pieces", () => { let s = ""; for (const c of ["t", "e", "x", "t"]) s += c; return s; }], ["a slice", () => "some text here".slice(5, 9)],
  ["a template", () => `${"te"}${"xt"}`], ["from codes", () => String.fromCharCode(116, 101, 120, 116)], ["parsed", () => JSON.parse('"text"')], ["parsed in an object", () => JSON.parse('{"k":"text"}').k],
  ["joined from an array", () => ["te", "xt"].join("")], ["replaced", () => "tent".replace("n", "x")], ["lower case", () => "TEXT".toLowerCase()], ["trimmed", () => "  text ".trim()], ["repeated", () => "text".repeat(1)],
  ["decoded", () => new TextDecoder().decode(new Uint8Array([116, 101, 120, 116]))], ["of a buffer", () => Buffer.from("74657874", "hex").toString()], ["wide, then cut", () => "text→".slice(0, 4)], ["a split", () => "a text b".split(" ")[1]!],
  ["a key", () => Object.keys({ text: 1 })[0]!], ["a match", () => /t..t/.exec("a text")![0]], ["padded", () => "tex".padEnd(4, "t")], ["a String object's", () => new String("text").valueOf()], ["concat", () => "te".concat("xt")],
];
const set = (o: any, k: string, v: unknown) => { o[k] = v; };
for (const [name, make] of makers) {
  const results: string[] = [];
  results.push(which({ kind: make(), text: "", n: 1 }));
  { const b: Block = { kind: "image", text: "", n: 1 }; b.kind = make(); results.push(which(b)); }
  { const b: Block = { kind: "image", text: "", n: 1 }; set(b, "kind", make()); results.push(which(b)); }
  { const b: Block = { kind: "image", text: "", n: 1 }; (b as any).kind = make(); results.push(which(b)); }
  { const b: Block = { kind: "image", text: "", n: 1 }; Object.assign(b, { kind: make() }); results.push(which(b)); }
  { const b: Block = { ...{ kind: "image", text: "", n: 1 }, kind: make() }; results.push(which(b)); }
  { const from: any = { kind: make(), text: "", n: 1 }; const b: Block = { ...from }; results.push(which(b)); }
  { const b: Block = { kind: "image", text: "", n: 1 }; Object.defineProperty(b, "kind", { value: make(), writable: true, enumerable: true, configurable: true }); results.push(which(b)); }
  { const b: Block = { kind: "image", text: "", n: 1 }; Reflect.set(b, "kind", make()); results.push(which(b)); }
  { const b = JSON.parse('{"kind":"image","text":"","n":1}') as Block; b.kind = make(); results.push(which(b)); }
  { const o: any = {}; o.n = 1; o.text = ""; o.kind = make(); results.push(which(o as Block)); }
  { const o: any = {}; o.kind = "image"; o.text = ""; o.n = 1; which(o as Block); o.kind = make(); results.push(which(o as Block)); }
  results.push(String(isText(make())), String(isText(({ kind: make(), text: "", n: 1 } as Block).kind)), which(new Holder(make()) as unknown as Block).slice(0, 4), textIs({ kind: "x", text: make(), n: 1 }));
  say(name, [...new Set(results)].join(" "));
}
for (const n of [0, 1, 2, 39, 40, 41, 42, 100, 5000]) {
  const digits = () => { let s = ""; for (let i = 0; i < n; i++) s += String(i % 10); return s; };
  const b: Block = { kind: digits(), text: digits(), n }; const c: Block = { kind: "x", text: "", n }; c.kind = digits(); set(c, "text", digits());
  say("of " + n, [which(b), which(c), textIs(b), textIs(c), b.kind === c.kind, b.text === c.text, b.kind === digits()]);
}
{ const h = new Holder("text"); for (let i = 0; i < 3000; i++) h.add("line " + i + "\n"); const b: Block = { kind: "text", text: "", n: 0 }; for (let i = 0; i < 3000; i++) b.text += "x"; say("added to", [h.text.length, h.text === "", b.text.length, textIs(b), h.kind === "text"]); }
{ const b: Block = { kind: "text", text: "", n: 0 }; const seen: string[] = []; for (let i = 0; i < 45; i++) { b.text += "t"; if (i < 5 || i > 37) seen.push(textIs(b)); } b.text = "te"; b.text += "xt"; seen.push(textIs(b)); say("grows past the limit", seen.join()); }
{ const list: Block[] = [{ kind: "text", text: "", n: 1 }, { kind: "text", text: "", n: 1, note: "y" + "es" }, { kind: "text", text: "", n: 1, note: "no" }, { kind: "text", text: "", n: 1, note: undefined }]; say("or undefined", list.map(isNote)); }
{ const o: Other = { kind: ("a" + "").slice(0, 1) as "a", label: "la" + half("belbel") }; say("literals", [o.kind === "a", o.kind === "b", o.label === "label", o.label !== "label"]); }
{ const long = () => { let s = ""; for (let i = 0; i < 60; i++) s += "z"; return s; }; const a: Block = { kind: long(), text: long(), n: 1 }, b: Block = { kind: long(), text: "te" + half("xtxt"), n: 1 }, c: Block = { kind: "x", text: "text", n: 1 };
  say("one with another", [a.kind === b.kind, a.kind === a.text, b.text === c.text, a.text === b.text, a.kind !== b.kind]); }
{ const b: Block = { kind: "te" + half("xtxt"), text: "", n: 1 }; const table: Record<string, number> = { text: 7 }; const m = new Map([["text", 8]]); say("used as a key", [table[b.kind], m.get(b.kind), new Set(["text"]).has(b.kind), ["text"].includes(b.kind), ["text"].indexOf(b.kind)]); }
export {};
