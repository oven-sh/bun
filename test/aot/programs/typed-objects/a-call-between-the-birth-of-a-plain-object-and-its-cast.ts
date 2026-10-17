type Message = { id: number; tags: string[] };
const makeMessage = (id: number, tags: string[]): Message => ({ id, tags });
const read = (message: Message) => message.id + message.tags.length;
const tags = ["x", "y"];
let kept: any;
let depth = 0;
function walk(n: number): number {
  depth++;
  if (kept && n === 0) kept.id += 100;
  return n > 0 ? walk(n - 1) + walk(n - 2) : 1;
}
async function later(n: number): Promise<number> {
  const message: any = { id: n, tags };
  kept = message;
  await null;
  return read(message);
}
function* steps(n: number) {
  const message: any = { id: n, tags };
  kept = message;
  yield 1;
  yield read(message);
}
console.log(read(makeMessage(1, tags)));
for (let i = 0; i < 3; i++) {
  const message: any = { id: i, tags };
  kept = message;
  const walked = walk(3);
  console.log(walked, read(message));
}
console.log(await later(5), [...steps(6)].join(), depth);
