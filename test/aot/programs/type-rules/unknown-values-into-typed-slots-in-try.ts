// Values whose type is not known enter typed places inside `try`: what does not fit is caught in the same function, and everything that was alive at the place is there in the handler.
type Point = { x: number; y: number };
function hide(value: unknown): any { return value; }
const point: Point = { x: 1, y: 2 };

function guarded(v: any, a: number, b: number, s: string, list: number[]): string {
    const p = a * 1.5, q = b + 0.25, w = s + "!", n = list.length, r = a - b, t = a * b;
    let state = "before";
    try {
        const text: string | undefined = v;
        state = "text " + (text ? text.length : "none");
        const numbers: number[] = hide(text && text.length > 2 ? [1, 2] : text);
        state += ", numbers " + (numbers ? numbers.length : "none");
        const held: Point = hide(numbers ? point : 7);
        state += ", point " + (held.x + held.y);
    } catch (error) {
        return [state, "caught", error instanceof TypeError, p, q, w, n, r, t].join(" ");
    }
    return [state, p, q, w, n, r, t].join(" ");
}
for (const value of [hide("long text"), hide("ab"), hide(undefined), hide(null), hide(5), hide(point), hide([1]), hide(true)])
    console.log(guarded(value, 2, 3, "s", [1, 2, 3]));

function nested(v: any, u: any): string {
    const trail: string[] = [];
    try {
        try {
            const first: Map<string, number> | undefined = v;
            trail.push("first " + (first ? first.size : "none"));
        } catch {
            trail.push("inner caught");
        } finally {
            trail.push("inner finally");
        }
        const second: () => number = u;
        trail.push("second " + second());
    } catch {
        trail.push("outer caught");
    } finally {
        trail.push("outer finally");
    }
    return trail.join(", ");
}
console.log(nested(new Map([["a", 1]]), () => 4));
console.log(nested(undefined, () => 5));
console.log(nested("no map", () => 6));
console.log(nested(new Map(), "no function"));
console.log(nested(1, 2));

function counted(values: any[]): string {
    let held = 0, refused = 0, sum = 0.5;
    for (let i = 0; i < values.length; i++) {
        const weight = i * 0.5;
        try {
            const text: string = values[i];
            held += text ? text.length : 0;
            sum += weight;
        } catch {
            refused++;
            sum -= weight;
        }
    }
    return held + " " + refused + " " + sum;
}
const many: any[] = [];
for (let i = 0; i < 30000; i++) many.push(i % 7 === 0 ? i : i % 5 === 0 ? undefined : "t" + (i & 3));
console.log(counted(many));

async function awaited(v: any): Promise<string> {
    const before = 1.5;
    try {
        const first: string = await v;
        const second: number[] = hide(first === "list" ? [1, 2, 3] : first);
        return "held " + second.length + " " + before;
    } catch (error) {
        return "caught " + (error instanceof TypeError) + " " + before;
    }
}
console.log(await awaited("list"), "|", await awaited("text"), "|", await awaited(Promise.resolve(3)), "|", await awaited(Promise.resolve("list")));
