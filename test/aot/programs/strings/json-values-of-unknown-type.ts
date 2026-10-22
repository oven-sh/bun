// `JSON.stringify` of typed objects whose `unknown` fields hold every kind of value, and the generic answer where the writer declines.
const print = (s: string) => console.log(s);
interface Box { before: number; value: unknown; after: string }
interface Point { x: number; y: number }
class L extends Array<number> { }
class Mixed extends Array<unknown> { }
class Labeled extends Array<number> {
    toJSON(): string {
        return "from subclass";
    }
}
class LaterDate extends Date { }

function box(value: unknown): Box {
    return { before: 1, value, after: "end" };
}
function attempt(f: () => unknown): string {
    try {
        return String(f());
    } catch (e) {
        return "throws " + (e as Error).name;
    }
}
function show(label: string, value: unknown): void {
    print(label);
    print("  property " + attempt(() => JSON.stringify(box(value))));
    print("  element  " + attempt(() => JSON.stringify([value, 2])));
    print("  nested   " + attempt(() => JSON.stringify(box(box(value)))));
    print("  root     " + attempt(() => JSON.stringify(value)));
}
function cat(a: string, b: string): string {
    return a + b;
}
function nestedArrays(depth: number): unknown {
    let value: unknown = [];
    for (let i = 0; i < depth; i++)
        value = [value];
    return value;
}
function pointWithExtraProperties(): Point {
    const point: Point = { x: 1, y: 2 };
    (point as any).z = "extra";
    (point as any)["with space"] = [3];
    return point;
}
function subclassInstance(): L {
    const list = new L();
    list.push(1, 2, 3);
    return list;
}
function mixedSubclassInstance(): Mixed {
    const list = new Mixed();
    list.push(1, "two", "日", { three: 3 }, [4]);
    return list;
}
function labeledSubclassInstance(): Labeled {
    const list = new Labeled();
    list.push(1, 2);
    return list;
}
function sparseSubclassInstance(): L {
    const list = new L(3);
    list[0] = 1;
    return list;
}

const point: Point = { x: 1, y: 2.5 };
show("typed object", point);
show("extra properties", pointWithExtraProperties());
show("ints", [1, 2, 3]);
show("doubles", [1.5, -0, 1e21, 2.5]);
show("strings", ["a", "b\"c", "日本"]);
show("typed objects", [point, { x: 3, y: 4 } as Point, point]);
show("nested arrays", nestedArrays(50));
show("shallow nested arrays", nestedArrays(5));
show("subclass", subclassInstance());
show("subclass with plain object", mixedSubclassInstance());
show("empty subclass", new L());
show("null prototype array", Object.setPrototypeOf([1, 2], null));
show("date", new Date(0));
show("invalid date", new Date(NaN));
show("wide string", "日本語");
show("wide string to escape", "日\"\n\ud800");
show("escapes", "quote \" backslash \\ newline \n tab \t control \u0001 end");
show("rope", cat("left side of the rope ".repeat(3), "right side of the rope ".repeat(3)));
show("wide rope", cat("left ".repeat(8), "日本".repeat(8)));
show("primitives", [null, true, false, 0, NaN, Infinity]);

show("function", () => 1);
show("symbol", Symbol("s"));
show("undefined", undefined);
show("function with toJSON", Object.assign(() => 1, { toJSON() { return "from function"; } }));
show("object with toJSON", { a: 1, toJSON() { return "from object"; } });
show("array with toJSON", Object.assign([1, 2], { toJSON() { return "from array"; } }));
show("subclass with toJSON", labeledSubclassInstance());
show("subclass instance with own toJSON", Object.assign(subclassInstance(), { toJSON() { return "from instance"; } }));
show("subclass with hole", sparseSubclassInstance());
show("array with toJSON on new prototype", Object.setPrototypeOf([1, 2], { toJSON() { return "from prototype"; } }));
const withGetter = pointWithExtraProperties();
Object.defineProperty(withGetter, "computed", { get() { return 7; }, enumerable: true });
show("getter among extra properties", withGetter);
show("hole", [1, , 3]);
show("wide string before hole", ["日", , 1]);
show("undefined and symbol elements", [undefined, Symbol("s"), () => 1]);
show("bigint", BigInt(10));
show("bigint element", [1, BigInt(10)]);
show("date subclass", new LaterDate(0));
print(attempt(() => JSON.stringify(undefined)));
print(attempt(() => JSON.stringify(() => 1)));
(L.prototype as any).toJSON = function () { return "added later"; };
show("subclass after toJSON is added", subclassInstance());
