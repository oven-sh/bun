// Every store to these `number` fields that the program shows puts an int32 into them: constants, bit operations, sums, copies, parameters and results that hold nothing else. So they are kept in four bytes.
// Stores under computed names, which show nothing, then bring every kind of number, and each is read back as it was stored.
declare const console: { log(...values: unknown[]): void };

type Flags = number;
const NoFlags: Flags = 0b0; const Placement: Flags = 0b10; const Update: Flags = 0b100; const StaticMask: Flags = 0b1100000;
interface Fiber { tag: number; flags: Flags; subtreeFlags: Flags; lanes: number; childLanes: number; index: number; ratio: number; child: Fiber | null; sibling: Fiber | null }
function FiberNode(this: Fiber, tag: number) {
    this.tag = tag; this.flags = NoFlags; this.subtreeFlags = NoFlags; this.lanes = 0; this.childLanes = 0; this.index = 0; this.ratio = 1; this.child = null; this.sibling = null;
}
function create(tag: number): Fiber { return new (FiberNode as any)(tag); }
function mergeLanes(a: number, b: number): number { return a | b; }
function bubble(f: Fiber): void {
    let subtreeFlags = NoFlags; let lanes = 0;
    for (let child = f.child; child !== null; child = child.sibling) {
        lanes = mergeLanes(lanes, mergeLanes(child.lanes, child.childLanes));
        subtreeFlags |= child.subtreeFlags & StaticMask; subtreeFlags |= child.flags;
    }
    f.subtreeFlags |= subtreeFlags; f.childLanes = lanes;
}
function mark(f: Fiber): void { f.flags |= Update; f.flags &= ~Placement; f.index++; f.ratio = f.ratio / 3; }
function copy(to: Fiber, from: Fiber): void { to.flags = from.flags & StaticMask; to.lanes = from.lanes; to.index = from.index; to.tag = from.tag; }

class Counter {
    hits = 0; mask = 0; total = 0; last: number | undefined = undefined;
    constructor(public step: number) {}
    bump(): void { this.last = this.hits; this.hits++; this.mask |= 1 << (this.hits & 7); this.total = this.total + this.step; }
}

function show(value: unknown): string { return typeof value === "number" && Object.is(value, -0) ? "-0" : String(value); }
function ofFiber(f: Fiber): string {
    return [f.tag, f.flags, f.subtreeFlags, f.lanes, f.childLanes, f.index, f.ratio, f.flags & Update, f.flags | 1, ~f.lanes, f.lanes >>> 1, f.index + 1, f.index * 2, f.tag === 3, f.tag < 2, -f.index, 1 / f.flags, [7, 8, 9][f.index], f.lanes ? 1 : 0].map(show).join(" ");
}
function ofCounter(c: Counter): string { return [c.hits, c.mask, c.total, c.last, c.step, c.hits & 3, c.total - 1, c.mask ^ 5, c.last === undefined].map(show).join(" "); }
function poke(target: any, name: string, value: unknown): void { target[name] = value; }
function peek(target: any, name: string): unknown { return target[name]; }

const root = create(3); let last: Fiber | null = null;
for (let i = 0; i < 5; i++) { const c = create(i); c.sibling = last; c.lanes = 1 << i; mark(c); last = c; }
root.child = last; bubble(root); const twin = create(1); copy(twin, root.child!);
console.log(ofFiber(root)); console.log(ofFiber(twin)); console.log(ofFiber(root.child!));
const counter = new Counter(2); for (let i = 0; i < 10; i++) counter.bump(); console.log(ofCounter(counter));

const fiberNames: string[] = JSON.parse('["tag","flags","subtreeFlags","lanes","childLanes","index"]');
const counterNames: string[] = JSON.parse('["hits","mask","total","last","step"]');
const numbers: number[] = JSON.parse("[0,-0,1,-1,0.5,-0.5,2147483646,2147483647,2147483648,-2147483642,-2147483643,-2147483644,-2147483645,-2147483646,-2147483647,-2147483648,-2147483649,4294967295,4294967296,9007199254740992,1e21,5e-324,1e400,-1e400]");
numbers.push(Number("x"));
for (const n of numbers) {
    const f = create(2); const c = new Counter(1); c.bump();
    for (const name of fiberNames) poke(f, name, n);
    for (const name of counterNames) poke(c, name, n);
    console.log(ofFiber(f), fiberNames.every(name => Object.is(peek(f, name), n)), Object.keys(f).join());
    console.log(ofCounter(c), counterNames.every(name => Object.is(peek(c, name), n)), Object.keys(c).join());
    mark(f); c.bump(); const g = create(0); copy(g, f); f.child = g; bubble(f);
    console.log(ofFiber(f)); console.log(ofFiber(g)); console.log(ofCounter(c));
    f.flags = NoFlags; f.lanes = 1; f.index = 0; f.tag = 3; console.log(ofFiber(f), JSON.stringify(f.child), Object.keys(f).join());
}
