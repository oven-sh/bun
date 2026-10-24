// One value enters two places annotated with the same type. The second test may be dropped only where the first one has already passed on every path. The test asks for an object; a field of another kind throws where it is read, a missing field reads undefined.
type Point = { x: number; y: number };
type Named = { name: string };

function attempt(label: string, run: () => unknown) {
    try {
        console.log(label, run());
    } catch (error) {
        console.log(label, error instanceof TypeError ? "TypeError" : String(error));
    }
}

function twice(value: any): number {
    const a: Point = value;
    const b: Point = value;
    return a.x + b.y;
}

function onlyOneBranchChecks(value: any, flag: boolean): number {
    let n = 0;
    if (flag) {
        const a: Point = value;
        n = a.x;
    }
    const b: Point = value;
    return n + b.y;
}

function bothBranchesCheck(value: any, flag: boolean): number {
    let n = 0;
    if (flag) {
        const a: Point = value;
        n = a.x;
    } else {
        const c: Point = value;
        n = c.y;
    }
    const b: Point = value;
    return n + b.y;
}

function firstFailureIsCaught(value: any): string {
    try {
        const a: Point = value;
        return "first passed " + a.x;
    } catch {}
    try {
        const b: Point = value;
        return "second passed " + b.x;
    } catch {
        return "second failed too";
    }
}

function reassignedBetween(good: any, bad: any): number {
    let value = good;
    const a: Point = value;
    value = bad;
    const b: Point = value;
    return a.x + b.y;
}

function reassignedByClosure(good: any, bad: any): number {
    let value = good;
    const replace = () => {
        value = bad;
    };
    const a: Point = value;
    replace();
    const b: Point = value;
    return a.x + b.y;
}

function twoTypes(value: any): string {
    const a: Point = value;
    const b: Named = value;
    return a.x + b.name;
}

function changedBetween(value: any, change: (value: any) => void): string {
    const a: Point = value;
    change(value);
    const b: Point = value;
    return typeof a.y + " " + typeof b.y + " " + (a === b);
}

function inLoop(values: any[], fixed: any): number {
    let sum = 0;
    for (const value of values) {
        const a: Point = value;
        const b: Point = fixed;
        const c: Point = value;
        sum += a.x + b.y + c.y;
    }
    return sum;
}

async function acrossAwait(value: any): Promise<number> {
    const a: Point = value;
    await null;
    const b: Point = value;
    return a.x + b.y;
}

function takesPoint(point: Point): number {
    return point.x * 10 + point.y;
}

function passedTwice(value: any): number {
    return takesPoint(value) + takesPoint(value);
}

function sameObject(value: any): boolean {
    const a: Point = value;
    const b: Point = value;
    return a === b && a === value;
}

const point: Point = { x: 1, y: 2 };
attempt("twice, a point", () => twice(point));
attempt("twice, a literal through any", () => twice({ x: 3, y: 4 }));
attempt("twice, parsed data", () => twice(JSON.parse('{"x":5,"y":6}')));
attempt("twice, y is missing", () => twice({ x: 1 }));
attempt("twice, a string", () => twice("point"));
attempt("twice, undefined", () => twice(undefined));
attempt("one branch, taken, a point", () => onlyOneBranchChecks(point, true));
attempt("one branch, not taken, a point", () => onlyOneBranchChecks(point, false));
attempt("one branch, taken, wrong", () => onlyOneBranchChecks({ x: "1" }, true));
attempt("one branch, not taken, wrong", () => onlyOneBranchChecks({ x: "1" }, false));
attempt("both branches, a point", () => bothBranchesCheck(point, true) + bothBranchesCheck(point, false));
attempt("both branches, wrong", () => bothBranchesCheck({ y: 2 }, false));
attempt("caught, a point", () => firstFailureIsCaught(point));
attempt("caught, wrong", () => firstFailureIsCaught({ x: 1, y: "2" }));
attempt("reassigned, good then good", () => reassignedBetween(point, { x: 7, y: 8 }));
attempt("reassigned, good then bad", () => reassignedBetween(point, { x: 7 }));
attempt("closure, good then good", () => reassignedByClosure(point, { x: 7, y: 8 }));
attempt("closure, good then bad", () => reassignedByClosure(point, null));
attempt("two types, both", () => twoTypes({ x: 1, y: 2, name: "n" }));
attempt("two types, only a point", () => twoTypes({ x: 1, y: 2 }));
attempt("changed, not at all", () => changedBetween({ x: 1, y: 2 }, () => {}));
attempt("changed, y is another number", () => changedBetween({ x: 1, y: 2 }, value => { value.y = 9; }));
attempt("changed, y is a string", () => changedBetween({ x: 1, y: 2 }, value => { value.y = "nine"; }));
attempt("changed, y is deleted", () => changedBetween({ x: 1, y: 2 }, value => { delete value.y; }));
attempt("changed, a property more", () => changedBetween({ x: 1, y: 2 }, value => { value.z = 3; }));
attempt("loop, all points", () => inLoop([point, { x: 3, y: 4 }], point));
attempt("loop, the second is wrong", () => inLoop([point, { x: 3 }], point));
attempt("loop, the fixed one is wrong", () => inLoop([point], 5));
attempt("loop, nothing to do", () => inLoop([], 5));
attempt("passed twice, a point", () => passedTwice(point));
attempt("passed twice, wrong", () => passedTwice({ x: 1, z: 2 }));
attempt("same object, a point", () => sameObject(point));
attempt("same object, a literal through any", () => sameObject({ x: 1, y: 2 }));
attempt("same object, parsed data", () => sameObject(JSON.parse('{"x":1,"y":2}')));
acrossAwait(point).then(
    value => console.log("across await, a point", value),
    error => console.log("across await, a point", String(error)),
);
acrossAwait({ y: 2 }).then(
    value => console.log("across await, wrong", value),
    error => console.log("across await, wrong", error instanceof TypeError ? "TypeError" : String(error)),
);
