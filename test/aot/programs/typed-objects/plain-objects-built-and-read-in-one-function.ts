type Inner = { n: number };
type Message = { id: number; inner: Inner; tags: string[]; note?: string };
const makeInner = (n: number): Inner => ({ n });
const makeMessage = (id: number, inner: Inner, tags: string[]): Message => ({ id, inner, tags, note: "n" });
const read = (message: Message) => message.id + message.inner.n + message.tags.length + (message.note === undefined ? 100 : message.note.length);
const inner = makeInner(7);
const tags = ["x", "y"];
let kept: any;
let touched = 0;
const touch = () => {
  touched++;
  if (kept) kept.id = 1000 + touched;
};
const anything = (value: unknown): any => value;
const say = (label: string, run: () => number) => {
  for (let i = 0; i < 3; i++) {
    try {
      console.log(label, i, run());
    } catch (error) {
      console.log(label, i, error instanceof TypeError ? "TypeError" : String(error));
    }
  }
};

console.log(read(makeMessage(1, inner, tags)));
say("built here", () => {
  const message: any = { id: 1 };
  message.inner = inner;
  message.tags = tags;
  message.note = "note";
  kept = message;
  return read(message);
});
console.log(Object.keys(kept).join(), kept.id, kept.note);
say("lacks the optional key", () => {
  const message: any = { id: 2, inner, tags };
  kept = message;
  return read(message);
});
console.log(Object.keys(kept).join(), "note" in kept);
say("stored twice", () => {
  const message: any = { id: 3, inner, tags };
  message.id = 30;
  kept = message;
  return read(message);
});
say("one key more", () => {
  const message: any = { id: 4, inner, tags, more: "more" };
  kept = message;
  return read(message);
});
console.log(Object.keys(kept).join(), kept.more);
say("changed by a call between", () => {
  const message: any = { id: 5, inner, tags };
  kept = message;
  touch();
  return read(message);
});
say("a value whose type is not known, which fits", () => {
  const message: any = { id: anything(6), inner, tags };
  kept = message;
  return read(message);
});
say("a value whose type is not known, which does not fit", () => {
  const message: any = { id: anything("six"), inner, tags };
  kept = message;
  return read(message);
});
say("a string for the number", () => {
  const message: any = { id: "seven", inner, tags };
  kept = message;
  return read(message);
});
say("a plain child", () => {
  const message: any = { id: 8, inner: { n: 80 }, tags };
  kept = message;
  return read(message);
});
say("another prototype by name", () => {
  const message: any = { id: 9, inner, tags };
  message.__proto__ = { note: "inherited" };
  kept = message;
  return read(message);
});
say("a getter laid over the number", () => {
  const message: any = { id: 10, inner, tags };
  Object.defineProperty(message, "id", { get: () => 11, enumerable: true, configurable: true });
  kept = message;
  return read(message);
});
say("deleted again", () => {
  const message: any = { id: 12, inner, tags, note: "gone" };
  delete message.note;
  kept = message;
  return read(message);
});
say("the number deleted", () => {
  const message: any = { id: 13, inner, tags };
  delete message.id;
  kept = message;
  return read(message);
});
say("frozen", () => {
  const message: any = { id: 14, inner, tags };
  Object.freeze(message);
  kept = message;
  return read(message) + (Object.isFrozen(message) ? 1000 : 0);
});
say("built in one arm only", () => {
  const message: any = { id: 15, inner };
  if (touched & 1) message.tags = tags;
  else message.tags = ["z"];
  touched++;
  kept = message;
  return read(message);
});
say("read twice", () => {
  const message: any = { id: 16, inner, tags };
  kept = message;
  return read(message) + read(message);
});
say("stored to after the read", () => {
  const message: any = { id: 17, inner, tags };
  kept = message;
  const first = read(message);
  message.id = 170;
  return first + read(message);
});
console.log(touched, typeof kept.id);
