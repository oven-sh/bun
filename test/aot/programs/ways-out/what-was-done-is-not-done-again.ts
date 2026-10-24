// A test of a type fails in the middle of a function. What the function has done up to there is done once, what comes behind is done once, and in the order of the source.
type Point = { x: number; y: number };
type Box = { name: string; at: Point; tags: string[] };
const log: string[] = [];
let counter = 0;
function note(what: string): number {
    log.push(what + "#" + ++counter);
    return counter;
}
function describe(box: Box, scale: number): string {
    const first = note("enter " + box.name);
    const x = box.at.x * scale;
    const second = note("x " + x);
    const y = box.at.y * scale;
    box.tags.push("seen" + first);
    const third = note("y " + y);
    return box.name + ":" + x + "," + y + ":" + (third - second) + ":" + box.tags.length;
}
const honest = (n: number): Box => ({ name: "b" + n, at: { x: n, y: n + 1 }, tags: [] });
const lines: string[] = [];
for (let round = 0; round < 400; round++) describe(honest(round), 2);
log.length = 0;
counter = 0;
const odd: unknown[] = [
    { name: "other order", tags: [], at: { y: 2, x: 1 } },
    { at: { x: 1, y: 2 }, name: "at first", tags: [] },
    { name: "point with more", at: { x: 1, y: 2, z: 3 }, tags: [] },
    { name: "x is a string", at: { x: "4", y: 2 }, tags: [] },
    { name: "y is missing", at: { x: 1 }, tags: [] },
    { name: "tags is array-like", at: { x: 1, y: 2 }, tags: { length: 0, push(this: { length: number }, v: string) { note("push " + v); return ++this.length; } } },
    { name: "getters", get at() { note("get at"); return { get x() { note("get x"); return 5; }, get y() { note("get y"); return 6; } }; }, tags: [] },
    Object.create({ name: "inherited", at: { x: 7, y: 8 }, tags: [] }),
    new Proxy({ name: "proxy", at: { x: 9, y: 10 }, tags: [] as string[] }, { get(target, key, receiver) { note("trap " + String(key)); return Reflect.get(target, key, receiver); } }),
];
for (const value of odd) {
    lines.push(describe(value as Box, 3));
    lines.push(describe(honest(1), 3));
}
console.log(lines.join("\n"));
console.log(log.join(" "));
