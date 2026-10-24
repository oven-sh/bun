// Object literals that are declared any and handed to a typed function at once: nothing else holds them, so they may be born as the record; and the neighbours that may not: held before or after, with a key more or fewer, in another order.
type Inner = { n: number };
type Message = { id: number; inner: Inner; tags: string[]; note?: string };

const lines: string[] = [];
const say = (label: string, ...values: unknown[]) => lines.push(label + ": " + values.map(value => JSON.stringify(value) ?? "undefined").join(" "));
let last: unknown;
function read(message: Message): number {
  last = message;
  return message.id + message.inner.n + message.tags.length + (message.note === undefined ? 0 : message.note.length);
}
function keysOf(message: Message): string {
  return Object.keys(message).join();
}
const inner: Inner = { n: 7 };
const tags = ["x", "y"];
const text = (n: number): any => "text" + n;
const anything = (value: unknown): any => value;

for (let i = 0; i < 4; i++) {
  const only: any = { id: i, inner, tags };
  say("only the function gets it " + i, read(only), last, Object.keys(last as object));

  const withNote: any = { id: i, inner, tags, note: "note" };
  say("with the optional field " + i, read(withNote), keysOf(last as Message));

  const otherOrder: any = { tags, note: "n", id: i, inner };
  say("in another order " + i, read(otherOrder), keysOf(last as Message), JSON.stringify(last));

  const heldAfter: any = { id: i, inner, tags };
  const sum = read(heldAfter);
  heldAfter.id = 100;
  say("held afterwards " + i, sum, heldAfter === last, (last as Message).id);

  const heldBefore: any = { id: i, inner, tags };
  const alias = heldBefore;
  say("held before " + i, read(heldBefore), alias === last);

  const surplus: any = { id: i, inner, tags, surplus: true };
  say("a key more " + i, read(surplus), keysOf(last as Message), (last as any).surplus);

  const unknownValues: any = { id: anything(i), inner: anything(inner), tags: anything(tags), note: text(i) };
  say("values of unknown type " + i, read(unknownValues), last);

  const plainInner: any = { id: i, inner: { n: i }, tags: ["only"] };
  say("a literal inside " + i, read(plainInner), last);

  const computed: any = { id: i, inner, tags, get note() { return "got"; } };
  say("a getter " + i, read(computed), keysOf(last as Message));

  const spread: any = { ...{ id: i, inner }, tags };
  say("a spread " + i, read(spread), keysOf(last as Message));

  const fraction: any = { id: i + 0.5, inner, tags };
  say("a fraction " + i, read(fraction), (last as Message).id);

  say("straight in the call " + i, read({ id: i, inner, tags } as any), keysOf(last as Message));
  const stored = last as any;
  stored.late = i;
  delete stored.id;
  say("changed from outside afterwards " + i, Object.keys(stored), stored.late, stored.id);
}
console.log(lines.join("\n"));
