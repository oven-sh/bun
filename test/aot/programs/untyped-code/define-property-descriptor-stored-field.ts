// A descriptor literal that gets one more field by assignment before it is passed to Object.defineProperty().
const lines: string[] = [];
const spell = (o: object, k: PropertyKey): string => { const d = Object.getOwnPropertyDescriptor(o, k) as Record<string, unknown> | undefined; return d ? ["value", "writable", "get", "set", "enumerable", "configurable"].filter(n => n in d).map(n => n + "=" + (typeof d[n] === "function" ? "function" : String(d[n]))).join() : "none"; };
const show = (title: string, f: () => unknown): void => { let text: string; try { text = String(f()); } catch (e) { text = "throws " + (e as Error).constructor.name + ": " + (e as Error).message; } lines.push(title + ": " + text); };

function getterStored(target: object, key: PropertyKey, load: () => unknown): object {
    const descriptor: PropertyDescriptor = { enumerable: true, configurable: true };
    descriptor.get = load;
    return Object.defineProperty(target, key, descriptor);
}
function setterStored(target: object, key: PropertyKey, load: () => unknown, keep: (v: unknown) => void): object {
    const descriptor: PropertyDescriptor = { get: load, configurable: true };
    descriptor.set = keep;
    return Object.defineProperty(target, key, descriptor);
}
function valueStored(target: object, key: PropertyKey, value: unknown): object {
    const descriptor: PropertyDescriptor = { writable: true, enumerable: false };
    descriptor.value = value;
    return Object.defineProperty(target, key, descriptor);
}
function constantKey(target: object, value: unknown): object {
    const descriptor: PropertyDescriptor = { enumerable: true };
    descriptor.value = value;
    return Object.defineProperty(target, "fixedName", descriptor);
}
function flagStored(target: object, key: PropertyKey, value: unknown): object {
    const descriptor: PropertyDescriptor = { value };
    descriptor.enumerable = true;
    return Object.defineProperty(target, key, descriptor);
}
function flagStoredByValue(target: object, key: PropertyKey, value: unknown, flag: boolean): object {
    const descriptor: PropertyDescriptor = { value };
    descriptor.enumerable = flag;
    return Object.defineProperty(target, key, descriptor);
}
function twoStored(target: object, key: PropertyKey, load: () => unknown, keep: (v: unknown) => void): object {
    const descriptor: PropertyDescriptor = { configurable: true };
    descriptor.get = load;
    descriptor.set = keep;
    return Object.defineProperty(target, key, descriptor);
}
function storedOver(target: object, key: PropertyKey, value: unknown): object {
    const descriptor: PropertyDescriptor = { value: "first", enumerable: true };
    descriptor.value = value;
    return Object.defineProperty(target, key, descriptor);
}
function bothKinds(target: object, key: PropertyKey, load: () => unknown): object {
    const descriptor: PropertyDescriptor = { value: 1 };
    descriptor.get = load;
    return Object.defineProperty(target, key, descriptor);
}
function otherName(target: object, key: PropertyKey, value: unknown): object {
    const descriptor: PropertyDescriptor & { other?: number } = { value };
    descriptor.other = 1;
    return Object.defineProperty(target, key, descriptor);
}
function keptAfterwards(target: object, key: PropertyKey, value: unknown): string {
    const descriptor: PropertyDescriptor = { enumerable: true };
    descriptor.value = value;
    Object.defineProperty(target, key, descriptor);
    return Object.keys(descriptor).join();
}
function noFunction(target: object, key: PropertyKey, load: any): object {
    const descriptor: PropertyDescriptor = { enumerable: true };
    descriptor.get = load;
    return Object.defineProperty(target, key, descriptor);
}
function emptyThenStored(target: object, key: PropertyKey, value: unknown): object {
    const descriptor: PropertyDescriptor = {};
    descriptor.value = value;
    return Object.defineProperty(target, key, descriptor);
}

const symbol = Symbol("key");
const receivers: Record<string, () => any> = {
    empty: () => ({}),
    has: () => JSON.parse('{"k":"old","fixedName":"old"}'),
    frozen: () => Object.freeze({ k: 1 }),
    notExtensible: () => Object.preventExtensions({}),
    array: () => [1],
    functionObject: () => function f() {},
    nil: () => null,
};
for (const receiver of Object.keys(receivers)) {
    for (const key of ["k", symbol, "0"] as PropertyKey[]) {
        const at = receiver + " " + String(key);
        let kept: unknown = "nothing kept";
        show("getter stored " + at, () => spell(getterStored(receivers[receiver]!(), key, () => 1), key));
        show("setter stored " + at, () => { const o = setterStored(receivers[receiver]!(), key, () => 1, v => { kept = v; }) as any; o[key] = "sent"; return spell(o, key) + " " + String(kept); });
        show("value stored " + at, () => spell(valueStored(receivers[receiver]!(), key, 2), key));
        show("flag stored " + at, () => spell(flagStored(receivers[receiver]!(), key, 3), key));
        show("flag stored by value " + at, () => spell(flagStoredByValue(receivers[receiver]!(), key, 3, key === "k"), key));
        show("two stored " + at, () => spell(twoStored(receivers[receiver]!(), key, () => 1, () => {}), key));
        show("stored over " + at, () => spell(storedOver(receivers[receiver]!(), key, "second"), key));
        show("both kinds " + at, () => spell(bothKinds(receivers[receiver]!(), key, () => 1), key));
        show("another name " + at, () => spell(otherName(receivers[receiver]!(), key, 4), key));
        show("kept afterwards " + at, () => { const o = receivers[receiver]!(); return keptAfterwards(o, key, 5) + " " + spell(o, key); });
        show("no function " + at, () => { try { return spell(noFunction(receivers[receiver]!(), key, 5), key); } catch (e) { return "throws " + (e as Error).constructor.name; } });
        show("empty, then stored " + at, () => spell(emptyThenStored(receivers[receiver]!(), key, 6), key));
    }
    show("constant key " + receiver, () => spell(constantKey(receivers[receiver]!(), 7), "fixedName"));
}
show("a table of a thousand getters", () => {
    const table: Record<string, unknown> = {};
    for (let i = 0; i < 1200; i++) getterStored(table, "name" + i, () => i * 2);
    let sum = 0;
    for (const k in table) sum += table[k] as number;
    return Object.keys(table).length + " " + sum + " " + spell(table, "name7");
});
console.log(lines.join("\n"));
