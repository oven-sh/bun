type Inner = { n: number };
type Message = { id: number; inner: Inner; tags: string[] };
const makeInner = (n: number): Inner => ({ n });
const makeMessage = (id: number, inner: Inner, tags: string[]): Message => ({ id, inner, tags });
const read = (message: Message) => message.id + message.inner.n + message.tags.length;
const tags = ["x", "y"];
const anything = (value: unknown): any => value;
let asked = 0;
const withGetter: Inner = anything(Object.defineProperty({}, "n", { get() { asked++; return 5; }, enumerable: true }));
const inheriting: Inner = anything(Object.create({ n: 6 }));
const frozen: Inner = anything(Object.freeze({ n: 7 }));
const typed = makeInner(8);
let kept: any;
console.log(read(makeMessage(1, typed, tags)));
for (const [label, inner] of [["a getter", withGetter], ["inherits", inheriting], ["frozen", frozen], ["typed", typed]] as [string, Inner][]) {
  for (let i = 0; i < 3; i++) {
    const message: any = { id: i, inner, tags };
    kept = message;
    console.log(label, i, read(message), asked, Object.keys(kept).join(), kept.inner === inner);
  }
}
const nothing: Inner = anything(null);
for (let i = 0; i < 2; i++) {
  try {
    const message: any = { id: i, inner: nothing, tags };
    kept = message;
    console.log("null", i, read(message));
  } catch (error) {
    console.log("null", i, error instanceof TypeError ? "TypeError" : String(error));
  }
}
