type Leaf = { v: number };
type Inner = { n: number; next: Inner | null; leaf?: Leaf };
type Message = { id: number; inner: Inner; tags: string[] };
const makeInner = (n: number): Inner => ({ n, next: null, leaf: { v: 1 } });
const makeMessage = (id: number, inner: Inner, tags: string[]): Message => ({ id, inner, tags });
const read = (message: Message) => message.id + message.inner.n + message.tags.length;
const readDeep = (message: Message) => message.id + message.inner.n + (message.inner.leaf === undefined ? 50 : message.inner.leaf.v);
const readNext = (message: Message) => message.id + (message.inner.next === null ? 7 : message.inner.next.n);
const tags = ["x", "y"];
let kept: any;
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

console.log(read(makeMessage(1, makeInner(7), tags)), readDeep(makeMessage(1, makeInner(7), tags)), readNext(makeMessage(1, makeInner(7), tags)));
say("a child built here", () => {
  const inner: any = { n: 10, next: null };
  const message: any = { id: 1, inner, tags };
  kept = message;
  return read(message);
});
console.log(Object.keys(kept).join(), Object.keys(kept.inner).join(), kept.inner.n);
say("a child written in the literal", () => {
  const message: any = { id: 2, inner: { n: 20, next: null }, tags };
  kept = message;
  return read(message);
});
say("the child is stored to after it was laid into the parent", () => {
  const inner: any = { n: 30, next: null };
  const message: any = { id: 3, inner, tags };
  inner.n = 31;
  kept = message;
  return read(message);
});
say("the child does not fit", () => {
  const message: any = { id: 4, inner: { n: "forty", next: null }, tags };
  kept = message;
  return read(message);
});
say("the child holds a value whose type is not known", () => {
  const message: any = { id: 5, inner: { n: anything(50), next: null }, tags };
  kept = message;
  return read(message);
});
say("the child lacks a key", () => {
  const message: any = { id: 6, inner: { n: 60 }, tags };
  kept = message;
  return read(message);
});
say("a grandchild", () => {
  const message: any = { id: 7, inner: { n: 70, next: null, leaf: { v: 700 } }, tags };
  kept = message;
  return readDeep(message);
});
say("no grandchild", () => {
  const message: any = { id: 8, inner: { n: 80, next: null }, tags };
  kept = message;
  return readDeep(message);
});
say("a grandchild that does not fit", () => {
  const message: any = { id: 9, inner: { n: 90, next: null, leaf: { v: "nine" } }, tags };
  kept = message;
  return readDeep(message);
});
say("a chain of two", () => {
  const message: any = { id: 10, inner: { n: 100, next: { n: 101, next: null } }, tags };
  kept = message;
  return readNext(message);
});
say("a child that refers to itself", () => {
  const inner: any = { n: 110, next: null };
  inner.next = inner;
  const message: any = { id: 11, inner, tags };
  kept = message;
  return readNext(message);
});
say("one child in two parents", () => {
  const inner: any = { n: 120, next: null };
  const first: any = { id: 12, inner, tags };
  const second: any = { id: 13, inner, tags };
  kept = [first, second];
  return read(first) + read(second);
});
say("the child is kept and changed by a call between", () => {
  const inner: any = { n: 130, next: null };
  kept = inner;
  const message: any = { id: 14, inner, tags };
  (() => { if (tags.length) kept.n++; })();
  return read(message);
});
say("the child is frozen", () => {
  const inner: any = Object.freeze({ n: 140, next: null });
  const message: any = { id: 15, inner, tags };
  kept = message;
  return read(message) + (Object.isFrozen(message.inner) ? 1000 : 0);
});
console.log(typeof kept);
