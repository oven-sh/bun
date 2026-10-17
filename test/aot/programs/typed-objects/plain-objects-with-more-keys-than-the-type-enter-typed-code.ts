// Plain objects that have more keys than the record type declares enter typed functions: the further keys stay, in their order, with their values; young and old objects, alone and inside others.
type Inner = { n: number };
type Message = { id: number; inner: Inner; tags: string[] };
type Envelope = { to: string; message: Message; copy: Message | null };

const lines: string[] = [];
const say = (label: string, ...values: unknown[]) => lines.push(label + ": " + values.map(value => JSON.stringify(value) ?? "undefined").join(" "));
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
function read(message: Message): number {
  return message.id + message.inner.n + message.tags.length;
}
function open(envelope: Envelope): number {
  return envelope.to.length + read(envelope.message) + (envelope.copy === null ? 0 : read(envelope.copy));
}
const inner: Inner = { n: 7 };
const tags = ["x", "y"];
const grow = (id: number, more: [string, unknown][], first = false): any => {
  const message: any = first ? { early: "early" } : {};
  message.id = id;
  message.inner = inner;
  message.tags = tags;
  for (const [key, value] of more) message[key] = value;
  return message;
};

for (let round = 0; round < 5; round++) {
  const one = grow(round, [["surplus", round]]);
  say("one key more " + round, read(one), Object.keys(one), one.surplus, one);
  one.surplus = "stored";
  one.later = true;
  say("stores from outside " + round, read(one), Object.keys(one), one.surplus, one.later);
  delete one.surplus;
  say("deleted " + round, read(one), Object.keys(one), "surplus" in one);

  const two = grow(round, [["a", { deep: round }], ["b", [round]]]);
  const held = two.a;
  say("two keys more " + round, read(two), Object.keys(two), two.a === held, two.b);

  const five = grow(round, [["a", 1], ["b", "two"], ["c", null], ["d", undefined], ["e", 5.5]]);
  say("five keys more " + round, read(five), Object.keys(five), five);

  const many = grow(round, Array.from({ length: 12 }, (_, i): [string, unknown] => ["k" + i, i]));
  say("twelve keys more " + round, read(many), Object.keys(many).length, many.k11);

  const early = grow(round, [["late", "late"]], true);
  say("a further key ahead of the declared ones " + round, read(early), Object.keys(early), early.early, early.late);

  const inside: any = { to: "somebody" };
  inside.message = grow(round, [["surplus", "inside"]]);
  inside.copy = round % 2 ? grow(round + 1, [["surplus", "copy"], ["second", 2]]) : null;
  inside.stamp = "stamp" + round;
  const message = inside.message;
  say("inside another " + round, open(inside), inside.message === message, Object.keys(inside), Object.keys(message), inside);
}

const old: any[] = [];
for (let i = 0; i < 40; i++) old.push(grow(i, [["surplus", "kept" + i]]));
collect();
collect();
let sum = 0;
for (const message of old) sum += read(message);
collect();
say("old objects", sum, old.every((message, i) => message.surplus === "kept" + i), Object.keys(old[39]));
const fresh: any[] = [];
for (let i = 0; i < 2000; i++) {
  const message = grow(i, [["surplus", { i }]]);
  sum += read(message);
  if (i % 100 === 0) fresh.push(message);
}
collect();
say("many young objects", sum, fresh.map(message => message.surplus.i));
console.log(lines.join("\n"));
