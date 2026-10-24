// A type declares a method that no code stores by name. It gets there by a key put together at run time, by Object.assign, by a definition, by run-time text, by a parse.
const lines: string[] = [];
const say = (text: string): void => { lines.push(text); };
function spell(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i++) result += text[i];
  return result;
}
class Plugin {
  name = "plugin";
  run?(): string;
  stop?(): string;
}
interface Hooks {
  name: string;
  before?(): string;
  after?(): string;
}
function callAll(p: Plugin): string {
  return p.name + " " + (p.run ? p.run() : "no run") + " " + (p.stop?.() ?? "no stop") + " " + typeof p.run + " " + ("run" in p) + " " + Object.keys(p).join("+");
}
function callHooks(h: Hooks): string {
  return h.name + " " + (h.before ? h.before() : "no before") + " " + (h.after?.() ?? "no after") + " " + typeof h.before + " " + ("before" in h);
}
const roads: [string, (o: object, key: string) => void][] = [
  ["by key", (o, key) => { (o as Record<string, unknown>)[spell(key)] = () => "ran " + key; }],
  ["assign", (o, key) => { Object.assign(o, { [spell(key)]: () => "assigned " + key }); }],
  ["define", (o, key) => { Object.defineProperty(o, spell(key), { value: () => "defined " + key, enumerable: true, configurable: true, writable: true }); }],
  ["getter", (o, key) => { Object.defineProperty(o, spell(key), { get: () => () => "got " + key, enumerable: true, configurable: true }); }],
  ["reflect", (o, key) => { Reflect.set(o, spell(key), () => "reflected " + key); }],
  ["text", (o, key) => { new Function("o", "k", "o[k] = () => 'text ' + k")(o, key); }],
  ["entries", (o, key) => { for (const [k, v] of Object.entries({ [spell(key)]: () => "entry " + key })) (o as Record<string, unknown>)[k] = v; }],
];
for (const [name, road] of roads) {
  const p = new Plugin();
  say(name + " new: " + callAll(p));
  road(p, "run");
  say(name + " run: " + callAll(p));
  road(p, "stop");
  say(name + " stop: " + callAll(p));
  const h: Hooks = { name: "hooks" };
  say(name + " new: " + callHooks(h));
  road(h, "after");
  say(name + " after: " + callHooks(h));
  road(h, "before");
  say(name + " before: " + callHooks(h));
}
console.log(lines.join("\n"));
