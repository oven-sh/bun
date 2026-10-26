declare const aotRuntimeCounters: undefined | (() => string);
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
// The texts that JSON.stringify left to the engine's own writer, and the values that compiled code handed to the run time.
const leftToTheEngine = () => (counted ? Number(/(\d+)\tcounter:JSONStringifySlowPaths/.exec(aotRuntimeCounters!())?.[1] ?? 0) + counted("operationAOTJSONAppendValue") + counted("operationAOTStringBuilderAppendJSON") : 0);
const left: string[] = [];
interface Item { id: number; title?: string; price?: number; hidden?: boolean }
interface Choice { yes?: boolean; no?: boolean | null; name: string }

function hide(value: unknown): any {
    return value;
}

function measure(label: string, run: () => string | undefined): void {
    const before = leftToTheEngine();
    let text: string | undefined = "";
    for (let i = 0; i < 100; i++) text = run();
    if (leftToTheEngine() !== before) left.push(label);
    console.log(label + ": " + text);
}

function item(bits: number): Item {
    const made: Item = { id: bits };
    if (bits & 1) made.title = "item " + bits;
    if (bits & 2) made.price = bits + 0.25;
    if (bits & 4) made.hidden = false;
    return made;
}

const items: Item[] = [];
for (let bits = 0; bits < 8; bits++) items.push(item(bits));
for (let bits = 0; bits < 8; bits++) measure("members " + bits, () => JSON.stringify(items[bits]));
const backwards: Item = { id: 9 };
backwards.hidden = true;
backwards.price = 1;
backwards.title = "backwards";
measure("created backwards", () => JSON.stringify(backwards));
const deleted = item(7);
delete deleted.price;
measure("one deleted", () => JSON.stringify(deleted));
deleted.price = 2;
measure("and created again", () => JSON.stringify(deleted));
const undefinedMembers: Item = { id: 10, title: undefined, price: undefined, hidden: undefined };
measure("set to undefined", () => JSON.stringify(undefinedMembers));
const choices: Choice[] = [{ name: "none" }, { yes: true, name: "yes" }, { yes: false, no: null, name: "both" }, { no: true, name: "no" }, { yes: undefined, no: undefined, name: "undefined" }];
for (const choice of choices) measure("booleans", () => JSON.stringify(choice));
const strange: Choice = { yes: true, name: "strange" };
hide(strange).extra = 1;
measure("an extra property", () => JSON.stringify(strange));
console.log("needed the engine: " + (counted ? left.join(" | ") : ""));
