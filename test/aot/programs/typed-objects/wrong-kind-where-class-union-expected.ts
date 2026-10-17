const lines: string[] = [];
function say(name: string, ...values: unknown[]): void { lines.push(name + " " + values.map(value => String(value)).join(" ")); }

interface Shape { name: string; sides: number; area?: number; label?: string }
class Circle implements Shape { name = "circle"; sides = 0; area?: number; radius: number; constructor(radius: number) { this.radius = radius; } }
class Square implements Shape { name = "square"; sides = 4; area?: number; label?: string; side: number; constructor(side: number) { this.side = side; } }
class Triangle implements Shape { name = "triangle"; sides = 3; label?: string; constructor(public base: number, public height: number) {} }
interface Tool { kind: string; weight: number; owner?: string }
class Hammer implements Tool { kind = "hammer"; weight = 3; owner?: string }
class Saw implements Tool { kind = "saw"; weight = 2; teeth = 40 }

function nameOf(shape: Shape): string { return shape.name; }
function sidesOf(shape: Shape): number { return shape.sides; }
function areaOf(shape: Shape): number | undefined { return shape.area; }
function labelOf(shape: Shape): string | undefined { return shape.label; }
function setArea(shape: Shape, area: number): void { shape.area = area; }
function setLabel(shape: Shape, label: string): void { shape.label = label; }
function describe(shape: Shape): string { return shape.name + ":" + shape.sides + ":" + shape.area + ":" + shape.label; }
function rename(shape: Shape, name: string): void { shape.name = name; shape.sides = shape.sides + 1; }
function kindOf(tool: Tool): string { return tool.kind + tool.weight + tool.owner; }
function lend(tool: Tool, owner: string): void { tool.owner = owner; }
function summary(shape: Shape): string { return [shape.name, shape.sides, shape.area, shape.label].join("/"); }
function isLabelled(shape: Shape): boolean { return shape.label !== undefined && shape.label.length > 0 && shape.name !== shape.label; }
function isMeasured(shape: Shape): boolean { return shape.area !== undefined && shape.area > 0 && shape.sides >= 0; }
function compare(a: Shape, b: Shape): number { return a.sides - b.sides || (a.area ?? 0) - (b.area ?? 0) || a.name.length - b.name.length; }
function copyInto(from: Shape, to: Shape): void { to.area = from.area; to.label = from.label; to.sides = from.sides; }
function swapNames(a: Shape, b: Shape): void { const name = a.name; a.name = b.name; b.name = name; }
function grow(shape: Shape): number { shape.sides += 1; shape.area = (shape.area ?? 0) + shape.sides; return shape.area; }
function title(shape: Shape): string { return (shape.label ?? shape.name).toUpperCase() + shape.sides; }
function same(a: Shape, b: Shape): boolean { return a.name === b.name && a.sides === b.sides && a.area === b.area && a.label === b.label; }
function reset(shape: Shape): void { shape.area = undefined; shape.label = undefined; shape.sides = 0; shape.name = "none"; }
function either(thing: Shape | Tool): string { return "name" in thing ? nameOf(thing) : kindOf(thing); }

const shapes: Shape[] = [new Circle(1), new Square(2), new Triangle(3, 4)];
const tools: Tool[] = [new Hammer(), new Saw()];
for (const shape of shapes) { say("own", nameOf(shape), sidesOf(shape), areaOf(shape), labelOf(shape), describe(shape)); }
for (const shape of shapes) { setArea(shape, 7); setLabel(shape, "l"); rename(shape, shape.name + "!"); say("stored", describe(shape), Object.keys(shape).join()); }
for (const tool of tools) { say("tool", kindOf(tool)); lend(tool, "me"); say("lent", kindOf(tool), Object.keys(tool).join()); }
say("either", either(shapes[0]), either(tools[1]));
for (const shape of shapes) say("more", summary(shape), isLabelled(shape), isMeasured(shape), compare(shape, shapes[1]), grow(shape), title(shape), same(shape, shapes[2]));
copyInto(shapes[0], shapes[1]); swapNames(shapes[1], shapes[2]);
for (const shape of shapes) say("moved", summary(shape));

const many: Record<string, unknown> = { name: "many", sides: 9 };
for (let i = 0; i < 40; i++) many["extra" + i] = i;
const withGetter = { get name() { return "getter"; }, sides: 1, get area() { return 5; } };
const frozen = Object.freeze({ name: "frozen", sides: 2 });
const inherits = Object.create({ name: "inherited", sides: 6, area: 8, label: "proto" });
const proxy = new Proxy({ name: "target", sides: 5 }, { get: (target, key) => (key === "sides" ? 55 : Reflect.get(target, key)) });
const list = Object.assign([1, 2, 3], { name: "array", sides: 3 });
const callable = Object.assign(function () {}, { sides: 8, label: "function" });
const map = Object.assign(new Map(), { name: "map", sides: 10 });
const date = Object.assign(new Date(0), { name: "date", sides: 11 });
const strangers: unknown[] = [many, withGetter, frozen, inherits, proxy, list, callable, map, date, { name: "plain", sides: 12 }];
for (const stranger of strangers) {
    const shape = stranger as Shape;
    say("stranger", nameOf(shape), sidesOf(shape), areaOf(shape), labelOf(shape), describe(shape));
    try { setLabel(shape, "set"); say("labelled", labelOf(shape)); } catch (error) { say("refused", (error as Error).constructor.name); }
    try { setArea(shape, 1); say("measured", areaOf(shape)); } catch (error) { say("refused", (error as Error).constructor.name); }
    say("looked at", summary(shape), isLabelled(shape), isMeasured(shape), compare(shape, shapes[0]), title(shape), same(shape, shape), same(shape, shapes[0]));
    try { say("grown", grow(shape)); copyInto(shapes[0], shape); swapNames(shape, shapes[1]); swapNames(shape, shapes[1]); say("after", summary(shape)); } catch (error) { say("refused", (error as Error).constructor.name); }
}
for (const nothing of [undefined, null] as unknown[]) {
    try { say("nothing", nameOf(nothing as Shape)); } catch (error) { say("threw", (error as Error).constructor.name); }
    try { setArea(nothing as Shape, 1); } catch (error) { say("threw", (error as Error).constructor.name); }
}
let total = 0;
for (let round = 0; round < 2000; round++) {
    for (const shape of shapes) total += sidesOf(shape) + (areaOf(shape) ?? 0) + nameOf(shape).length;
    total += sidesOf(strangers[round % strangers.length] as Shape) | 0;
}
say("total", total);
for (const shape of shapes) { reset(shape); say("reset", summary(shape)); }
console.log(lines.join("\n"));
