// A function that has gone on in another way is still one function on the stack, under its own name, at the line of the source. Other activations of it are not disturbed.
type Node = { value: number; child: Node | null };
function frames(error: Error): string {
    return (error.stack ?? "").split("\n").slice(1).map(line => /at (?:async )?(?:new )?([\w.$<>]+)/.exec(line)?.[1] ?? "?").filter(name => /^(walk|leaf|outer|thrower)$/.test(name)).join(">");
}
function thrower(): never {
    throw new Error("here");
}
function leaf(node: Node): number {
    const value = node.value;
    if (value < 0) thrower();
    return value;
}
function walk(node: Node, depth: number): number {
    const own = leaf(node);
    const below = node.child ? walk(node.child, depth + 1) : 0;
    return own + below * 2 + node.value;
}
function outer(node: Node): string {
    try {
        return String(walk(node, 0));
    } catch (error) {
        return frames(error as Error);
    }
}
const chain = (values: unknown[]): Node => values.reduceRight<Node | null>((child, value) => (typeof value === "number" ? { value, child } : Object.assign(value as object, { child })) as Node, null)!;
const lines: string[] = [];
for (let round = 0; round < 400; round++) outer(chain([1, 2, 3, round]));
lines.push(outer(chain([1, 2, 3])));
lines.push(outer(chain([1, { extra: 0, value: 2 }, 3])));
lines.push(outer(chain([{ extra: 0, value: 1 }, 2, { more: 1, value: 3 }, 4])));
lines.push(outer(chain([1, 2, -1])));
lines.push(outer(chain([1, { extra: 0, value: 2 }, -1])));
lines.push(outer(chain([{ extra: 0, value: 1 }, { extra: 0, value: 2 }, { extra: 0, value: -1 }])));
lines.push(outer(chain([1, { get value() { return thrower(); } }, 3])));
console.log(lines.join("\n"));
