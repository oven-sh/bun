// Messages told apart by a string, each handled by a function typed with its own member of the union, and a field whose function type is a union with a type that no function is converted to.
try {
  require("late-package");
} catch {}
const world = globalThis as any;

type Ping = { type: "ping"; id: number };
type Text = { type: "text"; id: number; text: string };
type Image = { type: "image"; id: number; width: number; height: number };
type Move = { type: "move"; id: number; dx: number; dy: number };
type Join = { type: "join"; id: number; room: number };
type Leave = { type: "leave"; id: number; room: number; reason: number };
type Score = { type: "score"; id: number; points: number };
type Close = { type: "close"; id: number; code: number; clean: boolean };
type Message = Ping | Text | Image | Move | Join | Leave | Score | Close;

function onPing(m: Ping): number {
  return m.id;
}
function onText(m: Text): number {
  return m.id + m.text.length;
}
function onImage(m: Image): number {
  return m.id + m.width * m.height;
}
function onMove(m: Move): number {
  return m.id + m.dx - m.dy;
}
function onJoin(m: Join): number {
  return m.id + m.room;
}
function onLeave(m: Leave): number {
  return m.id + m.room - m.reason;
}
function onScore(m: Score): number {
  return m.id + m.points;
}
function onClose(m: Close): number {
  return m.id + (m.clean ? m.code : -m.code);
}
function handle(m: Message): number {
  switch (m.type) {
    case "ping":
      return onPing(m);
    case "text":
      return onText(m);
    case "image":
      return onImage(m);
    case "move":
      return onMove(m);
    case "join":
      return onJoin(m);
    case "leave":
      return onLeave(m);
    case "score":
      return onScore(m);
    case "close":
      return onClose(m);
  }
}
function handleAll(list: Message[], rounds: number): number {
  let r = 0;
  for (let i = 0; i < rounds; i++) r = (r + handle(list[i & 63])) | 0;
  return r;
}
function sumOfPings(list: Ping[], rounds: number): number {
  let r = 0;
  for (let i = 0; i < rounds; i++) r = (r + onPing(list[i & 63])) | 0;
  return r;
}
function sumOfJoins(list: Join[], rounds: number): number {
  let r = 0;
  for (let i = 0; i < rounds; i++) r = (r + onJoin(list[i & 63])) | 0;
  return r;
}

type OnNumber = (n: number) => number;
type OnText = (s: string) => string;
type Step = { label: number; run: OnNumber };
type TextStep = { label: number; run: OnText };
function double(n: number): number {
  return (n * 2) | 0;
}
function increment(n: number): number {
  return (n + 1) | 0;
}
function labelOfTextStep(s: TextStep): number {
  return s.label;
}
function runSteps(list: Step[], rounds: number): number {
  let r = 0;
  for (let i = 0; i < rounds; i++) r = list[i & 63].run(r) & 0xffff;
  return r;
}

const messages: Message[] = [];
const pings: Ping[] = [];
const joins: Join[] = [];
const steps: Step[] = [];
for (let i = 0; i < 64; i++) {
  pings.push({ type: "ping", id: i });
  joins.push({ type: "join", id: i, room: 3 });
  steps.push({ label: i, run: i % 2 === 0 ? double : increment });
  switch (i & 7) {
    case 0:
      messages.push({ type: "ping", id: i });
      break;
    case 1:
      messages.push({ type: "text", id: i, text: "abc" });
      break;
    case 2:
      messages.push({ type: "image", id: i, width: 2, height: 3 });
      break;
    case 3:
      messages.push({ type: "move", id: i, dx: 5, dy: 2 });
      break;
    case 4:
      messages.push({ type: "join", id: i, room: 3 });
      break;
    case 5:
      messages.push({ type: "leave", id: i, room: 3, reason: 1 });
      break;
    case 6:
      messages.push({ type: "score", id: i, points: 9 });
      break;
    default:
      messages.push({ type: "close", id: i, code: 4, clean: i % 16 === 7 });
  }
}
world.messages = messages;
world.pings = pings;
world.joins = joins;
world.steps = steps;
world.functions = [handle, handleAll, sumOfPings, sumOfJoins, runSteps, labelOfTextStep];

const which = process.env.KERNEL ?? "";
const rounds = which === "" ? 64 : 4_000_000;

// Tags that stop being what their type says.
type Cat = { sort: "cat"; lives: number };
type Dog = { sort: "dog"; lives: number; tricks: number };
type Pet = Cat | Dog;
function describe(p: Pet): string {
  switch (p.sort) {
    case "cat":
      return "cat " + p.lives;
    case "dog":
      return "dog " + p.lives + " " + p.tricks;
    default:
      return "other " + String((p as any).sort);
  }
}
function livesOfCat(c: Cat): number {
  return c.lives;
}
function makeCat(): Cat {
  return { sort: "cat", lives: 9 };
}
function makeDog(): Dog {
  return { sort: "dog", lives: 1, tricks: 3 };
}
const changes: Array<[string, (p: any) => any]> = [
  ["nothing", p => p],
  ["the other tag", p => ((p.sort = p.sort === "cat" ? "dog" : "cat"), p)],
  ["the same tag, put together at run time", p => ((p.sort = [p.sort.slice(0, 1), p.sort.slice(1)].join("")), p)],
  ["the other tag, put together at run time", p => ((p.sort = (p.sort === "cat" ? ["d", "og"] : ["c", "at"]).join("")), p)],
  ["a string that is no tag", p => ((p.sort = "bird"), p)],
  ["a number", p => ((p.sort = 5), p)],
  ["undefined", p => ((p.sort = undefined), p)],
  ["null", p => ((p.sort = null), p)],
  ["an object", p => ((p.sort = { toString: () => "cat" }), p)],
  ["deleted", p => (delete p.sort, p)],
  ["deleted, then stored again", p => (delete p.sort, (p.sort = "dog"), p)],
  ["a getter", p => Object.defineProperty(p, "sort", { get: () => "dog", configurable: true })],
  ["read-only with the other tag", p => Object.defineProperty(p, "sort", { value: p.sort === "cat" ? "dog" : "cat", writable: false })],
  ["Reflect.set", p => (Reflect.set(p, "sort", "dog"), p)],
  ["Object.assign", p => Object.assign(p, { sort: "cat" })],
  ["frozen", p => Object.freeze(p)],
  ["inherited", p => (delete p.sort, Object.setPrototypeOf(p, { sort: "dog", tricks: 7 }))],
  ["a copy by spread with the other tag", p => ({ ...p, sort: p.sort === "cat" ? "dog" : "cat" })],
  ["parsed", p => JSON.parse(JSON.stringify(p))],
  ["a proxy", p => new Proxy(p, { get: (t, k) => (k === "sort" ? "dog" : t[k]) })],
];
world.changes = changes;
world.pets = [describe, livesOfCat, makeCat, makeDog];
if (which === "") {
  for (const [name, change] of changes) {
    for (const make of [makeCat, makeDog]) {
      const pet = change(make());
      console.log(name, "|", describe(pet), "|", livesOfCat(pet), "|", describe(make()));
    }
  }
}
if (which === "" || which === "handle") console.log(handleAll(world.messages, rounds));
if (which === "" || which === "pings") console.log(sumOfPings(world.pings, rounds));
if (which === "" || which === "joins") console.log(sumOfJoins(world.joins, rounds));
if (which === "" || which === "steps") console.log(runSteps(world.steps, rounds));
export {};
