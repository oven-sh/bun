class Node {
    next: Node | null = null;
    other: Node | undefined = undefined;
    either: Node | null | undefined = null;
    value = 0;
    wide = 0.5;
    name = "n";
    constructor(value: number) { this.value = value; }
    bump(): number { return ++this.value; }
}

let current: Node | undefined;
let last: Node | null = null;

function withoutSourceText(text: string): string {
    const start = text.indexOf(" (evaluating ");
    return start < 0 ? text : text.slice(0, start);
}

function message(run: () => unknown): string {
    try {
        return "returned " + String(run());
    } catch (error) {
        return (error as Error).constructor.name + ": " + withoutSourceText((error as Error).message);
    }
}

function readNext(node: Node): number { return node.next!.value; }
function readOther(node: Node): number { return node.other!.value; }
function readEither(node: Node): number { return node.either!.value; }
function readWide(node: Node): number { return node.next!.wide; }
function readName(node: Node): string { return node.other!.name; }
function writeNext(node: Node): number { node.next!.value = 7; return node.next!.value; }
function writeOther(node: Node): number { node.other!.wide = 7.5; return node.other!.wide; }
function callNext(node: Node): number { return node.next!.bump(); }
function callOther(node: Node): number { return node.other!.bump(); }
function twoLinks(node: Node): number { return node.next!.next!.value; }
function threeLinks(node: Node): number { return node.next!.other!.either!.value; }
function readCurrent(): number { return current!.value; }
function readLast(): number { return last!.value; }
function compareThenRead(node: Node, other: Node | null): number { return node.next === other ? node.next!.value : -1; }
function keepThenRead(node: Node, sink: (Node | null)[]): number { const next = node.next; sink.push(next); return next!.value; }
function readInTry(node: Node): string { try { return "read " + node.next!.value; } catch (error) { return "caught " + withoutSourceText((error as Error).message); } finally { node.value++; } }
function walk(node: Node | null): number { let sum = 0; while (node !== null) { sum += node.value; node = node.next; } return sum; }
function walkEither(node: Node | null | undefined): number { let sum = 0; while (node !== null) { sum += node!.value; node = node!.either; } return sum; }
function walkOther(node: Node | undefined): number { let sum = 0; for (; node !== undefined; node = node.other) sum += node.value; return sum; }
function walkUnchecked(node: Node): number { let sum = 0; for (let count = 0; count < 5; count++) { sum += node.value; node = node.next!; } return sum; }
function deleteThrough(node: Node): boolean { return delete (node.next as unknown as Record<string, unknown>).nothing; }
function destructure(node: Node): number { const { value } = node.other!; return value; }
function optional(node: Node): number | undefined { return node.next?.value; }
function optionalThenRead(node: Node): number { return node.next?.next!.value ?? -2; }

function chain(length: number): Node {
    const head = new Node(1);
    let tail = head;
    for (let index = 2; index <= length; index++) {
        const node = new Node(index);
        tail.next = node; tail.other = node; tail.either = node;
        tail = node;
    }
    return head;
}

const functions: [string, (node: Node) => unknown][] = [
    ["readNext", readNext], ["readOther", readOther], ["readEither", readEither], ["readWide", readWide], ["readName", readName], ["writeNext", writeNext], ["writeOther", writeOther],
    ["callNext", callNext], ["callOther", callOther], ["twoLinks", twoLinks], ["threeLinks", threeLinks], ["readInTry", readInTry], ["deleteThrough", deleteThrough],
    ["destructure", destructure], ["optional", optional], ["optionalThenRead", optionalThenRead], ["walkUnchecked", walkUnchecked],
    ["compareThenRead null", node => compareThenRead(node, null)], ["compareThenRead itself", node => compareThenRead(node, node.next)], ["keepThenRead", node => { const sink: (Node | null)[] = []; const text = message(() => keepThenRead(node, sink)); return text + " kept " + (sink[0] === null ? "null" : typeof sink[0]); }],
];

for (let round = 0; round < 3; round++) {
    for (const length of [1, 2, 3, 4, 7]) {
        for (const [name, run] of functions)
            console.log(round, length, name, message(() => run(chain(length))));
        const head = chain(length);
        console.log(round, length, "walk", walk(head), walkOther(head), message(() => walkEither(head)));
        let tail = head;
        while (tail.next !== null) tail = tail.next;
        tail.either = undefined;
        console.log(round, length, "walkEither to undefined", message(() => walkEither(head)));
    }
    console.log(round, "current", message(readCurrent), "last", message(readLast));
    current = new Node(40 + round); last = new Node(50 + round);
    console.log(round, "current", message(readCurrent), "last", message(readLast));
    current = undefined; last = null;
}
