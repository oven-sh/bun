declare const aotRuntimeCounters: () => string;
const writersFailed = () => Number(/(\d+)\tJSONWriterFailed/.exec(aotRuntimeCounters())![1]);
declare const aotOperationCount: (name: string) => number;
interface Address { street: string; city: string }
interface User { id: number; name: string; address: Address; tags: string[] }
interface Link { value: number; next: Link | null }
interface Tree { name: string; children: Tree[] }
class Point {
    constructor(public x: number, public y: number) {}
}

function hide(value: unknown): any {
    return value;
}

function send(value: any): string {
    return JSON.stringify(value);
}

const reply = {
    json(value: any): string {
        return JSON.stringify(value);
    },
};

class Context {
    sent = 0;
    json = (value: any): string => {
        this.sent++;
        return JSON.stringify(value);
    };
}
const context = new Context();

let finished = 0;
let handedOver = 0;

function begin(): void {
    finished = (aotOperationCount("operationAOTJSONWriterFinish") - writersFailed());
    handedOver = aotOperationCount("operationAOTJSONAppendValue");
}

function report(label: string, text: string): void {
    console.log(label + ": " + text.length + " characters, " + ((aotOperationCount("operationAOTJSONWriterFinish") - writersFailed()) - finished) + " texts finished by compiled code, " + (aotOperationCount("operationAOTJSONAppendValue") - handedOver) + " values handed to the runtime");
}

function measure(label: string, value: unknown): void {
    let text = "";
    begin();
    for (let i = 0; i < 100; i++) text = send(value);
    report(label + ", through a function", text);
    begin();
    for (let i = 0; i < 100; i++) text = reply.json(value);
    report(label + ", through a method", text);
    begin();
    for (let i = 0; i < 100; i++) text = context.json(value);
    report(label + ", through an arrow function in a field", text);
}

function user(i: number): User {
    return { id: i, name: "user " + i, address: { street: i + " Main Street", city: "Springfield" }, tags: ["a" + i, "b"] };
}

function tree(depth: number): Tree {
    const made: Tree = { name: "d" + depth, children: [] };
    for (let i = 0; depth && i < 2; i++) made.children.push(tree(depth - 1));
    return made;
}

measure("a record", user(1));
let chain: Link | null = null;
for (let i = 0; i < 40; i++) chain = { value: i, next: chain };
measure("forty records in a chain", chain);
measure("a tree five levels deep", tree(5));
const withExtra = user(2);
hide(withExtra).extra = 1;
measure("a property that the type does not name", withExtra);
const withExtraInside = user(3);
hide(withExtraInside.address).extra = 1;
measure("such a property one level down", withExtraInside);
measure("an object without a type", JSON.parse('{"id":7,"name":"seven"}'));
measure("an object of a class", new Point(1, 2));
measure("a string", "text");
