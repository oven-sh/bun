// `byteLength` of a DataView or an ArrayBuffer compared on every turn of a loop: real ones, heirs, ones with an own property or another prototype answer as in plain Bun. `DataView` and `ArrayBuffer` name built-in classes, so an object of another class does not enter a place that is written so. The look-alikes pass their cast, but they come out of functions that are called through a table, where nobody sees the cast: the written place behind the call throws a TypeError.
// IRT= 1 scan TypeTest v[0-9]+ testedType=\w\S*\^
// IRT= 1 scan : int.0,[0-9]+. = CallBuiltin .* overload=DataViewPrototypeByteLength/
// IRT= 2 scan Less
// IRT= 1 scan name="byteLength".* isFallback
// IRT= 1 down TypeTest v[0-9]+ testedType=\w\S*\^
// IRT= 2 down Greater
// IRT= 0 kept TypeTest v[0-9]+ testedType=\w\S*\^
// IRT= 2 kept Less
// IRT= 0 once TypeTest v[0-9]+ testedType=\w\S*\^
let visits = 0;
function scan(view: DataView, visit: (at: number) => void): number {
    let count = 0;
    for (let i = 0; i < view.byteLength; i++) {
        visit(i);
        count++;
    }
    return count;
}

function down(buffer: ArrayBuffer, from: number, visit: (at: number) => void): number {
    let count = 0;
    for (let i = from; buffer.byteLength > i; i++) {
        visit(i);
        count++;
    }
    return count;
}

function kept(view: DataView, visit: (at: number) => void): string {
    let seen = "";
    for (let i = 0; i < 3; i++) {
        const length = view.byteLength;
        if (i < length)
            visit(i);
        seen += length + " ";
    }
    return seen;
}

function once(view: DataView, least: number): boolean {
    return least < view.byteLength;
}

function attempt(what: string, run: () => unknown): void {
    try {
        console.log(what, String(run()), visits);
    } catch (error) {
        console.log(what, "throws", (error as Error).constructor.name, visits);
    }
}

class Longer extends DataView<ArrayBuffer> {
    get byteLength(): number {
        visits += 100;
        return super.byteLength + 1;
    }
}

const bytes = (): ArrayBuffer => new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer;
const visit = (): void => { visits++; };

function views(): [string, () => DataView][] {
    return [
        ["real", () => new DataView(bytes())],
        ["of a part", () => new DataView(bytes(), 1, 2)],
        ["of nothing", () => new DataView(new ArrayBuffer(0))],
        ["heir", () => new Longer(bytes())],
        ["with its own", () => Object.defineProperty(new DataView(bytes()), "byteLength", { value: 2 })],
        ["of another prototype", () => Object.setPrototypeOf(new DataView(bytes()), { get byteLength() { visits += 1000; return 3; } })],
        ["that lacks it", () => Object.setPrototypeOf(new DataView(bytes()), {})],
        ["look-alike", () => ({ byteLength: 3 }) as unknown as DataView],
        ["empty look-alike", () => ({}) as unknown as DataView],
        ["that counts", () => ({ get byteLength() { visits += 10000; return 2; } }) as unknown as DataView],
        ["proxy", () => new Proxy(new DataView(bytes()), {})],
        ["null", () => null as unknown as DataView],
        ["undefined", () => undefined as unknown as DataView],
    ];
}

function buffers(): [string, () => ArrayBuffer][] {
    return [
        ["real", () => bytes()],
        ["empty", () => new ArrayBuffer(0)],
        ["with an own property", () => Object.assign(bytes(), { tag: 1 })],
        ["of another prototype", () => Object.setPrototypeOf(bytes(), { get byteLength() { visits += 1000; return 2; } })],
        ["that lacks it", () => Object.setPrototypeOf(bytes(), {})],
        ["look-alike", () => ({ byteLength: 3 }) as unknown as ArrayBuffer],
        ["null", () => null as unknown as ArrayBuffer],
    ];
}

const table = { scan, down, kept, once };
const byTable: { [name: string]: (...rest: any[]) => unknown } = table;

for (let round = 0; round < 3; round++) {
    for (const [name, make] of views()) {
        attempt("scan " + name, () => scan(make(), visit) + " " + byTable.scan(make(), visit));
        attempt("scan, shrinking " + name, () => { const made = make(); return scan(made, at => { if (at === 1) Object.defineProperty(made, "byteLength", { value: undefined, configurable: true }); }); });
        attempt("kept " + name, () => kept(make(), visit) + " " + byTable.kept(make(), visit));
        attempt("once " + name, () => once(make(), 2) + " " + byTable.once(make(), 3));
    }
    for (const [name, make] of buffers())
        attempt("down " + name, () => down(make(), 1, visit) + " " + byTable.down(make(), 0, visit));
}
