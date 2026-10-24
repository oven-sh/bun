// What a function knows beside its parameters: how many arguments it got, the rest of them, this, new.target, and the variables of the functions around it.
type Pair = { l: number; r: number };
function counted(this: unknown, pair: Pair, extra?: number): string {
    const before = arguments.length;
    const sum = pair.l + pair.r;
    return before + ":" + sum + ":" + arguments.length + ":" + Array.prototype.slice.call(arguments, 1).join("/") + ":" + typeof this + ":" + extra;
}
function rest(pair: Pair, ...others: number[]): string {
    const first = others.length;
    const sum = pair.l + pair.r;
    others.push(sum);
    return first + ":" + others.join("/");
}
function makeCounter(start: number) {
    let count = start;
    return function step(pair: Pair): string {
        count++;
        const l = pair.l;
        count += 10;
        const r = pair.r;
        count += 100;
        return count + ":" + (l + r);
    };
}
class Holder {
    total = 0;
    made: unknown;
    constructor(pair: Pair) {
        this.total += 1;
        this.total += pair.l;
        this.made = new.target === Holder;
        this.total += pair.r;
    }
    add(pair: Pair): this {
        this.total += pair.l * 2;
        this.total += pair.r * 3;
        return this;
    }
}
const lines: string[] = [];
const step = makeCounter(0);
for (let round = 0; round < 400; round++) {
    counted.call(null, { l: 1, r: 2 }, round);
    rest({ l: 1, r: 2 }, round, round);
    makeCounter(round)({ l: 1, r: 2 });
    new Holder({ l: 1, r: 2 }).add({ l: 1, r: 2 });
}
for (const pair of [{ l: 1, r: 2 }, { r: 2, l: 1 }, { l: 1, get r() { return 20; } }, { l: "1", r: 2 }, Object.create({ l: 5, r: 6 })] as Pair[]) {
    lines.push(counted.call("text", pair));
    lines.push((counted as (...all: unknown[]) => string).call({ }, pair, 1, 2, 3, 4, 5, 6, 7));
    lines.push(rest(pair));
    lines.push(rest(pair, 1, 2, 3, 4, 5, 6, 7, 8, 9));
    lines.push(step(pair));
    const holder = new Holder(pair);
    lines.push(holder.total + ":" + holder.made + ":" + (holder.add(pair) === holder) + ":" + holder.total);
}
console.log(lines.join("\n"));
