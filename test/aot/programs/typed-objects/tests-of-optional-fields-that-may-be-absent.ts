// An optional field that is missing, holds undefined, null or a falsy value answers every test (truthiness, === undefined, == null, ??, typeof, ?.) as in plain Bun, whichever way its slot stores it.
type Child = { id: number };
type Options = { count?: number; ratio?: number | null; child?: Child; other?: Child | null; name?: string; flag?: boolean; y: number };

const seed: any = JSON.parse('{"zero":0,"five":5,"half":0.5,"text":"a","empty":""}');
const child: Child = { id: seed.five };

const all: Options[] = [
    { y: 1 },
    { count: undefined, ratio: undefined, child: undefined, other: undefined, name: undefined, flag: undefined, y: 2 },
    { count: seed.zero, ratio: null, child, other: null, name: seed.empty, flag: false, y: 3 },
    { count: -0, ratio: NaN, child, other: child, name: seed.text, flag: true, y: 4 },
    { count: seed.five, ratio: seed.half, y: 5 },
    { count: NaN, ratio: Infinity, name: "undefined", y: 6 },
];

function truthiness(o: Options): string {
    return (o.count ? "1" : "0") + (o.ratio ? "1" : "0") + (o.child ? "1" : "0") + (o.other ? "1" : "0") + (o.name ? "1" : "0") + (o.flag ? "1" : "0");
}
function isUndefined(o: Options): string {
    return (o.count === undefined ? "1" : "0") + (o.ratio === undefined ? "1" : "0") + (o.child === undefined ? "1" : "0") + (o.other === undefined ? "1" : "0") + (o.name === undefined ? "1" : "0") + (o.flag === undefined ? "1" : "0");
}
function isNotUndefined(o: Options): string {
    return (o.count !== undefined ? "1" : "0") + (o.ratio !== undefined ? "1" : "0") + (o.child !== undefined ? "1" : "0") + (o.other !== undefined ? "1" : "0") + (o.name !== undefined ? "1" : "0") + (o.flag !== undefined ? "1" : "0");
}
function isNull(o: Options): string {
    return (o.ratio === null ? "1" : "0") + (o.other === null ? "1" : "0");
}
function isNullish(o: Options): string {
    return (o.count == null ? "1" : "0") + (o.ratio == null ? "1" : "0") + (o.child == null ? "1" : "0") + (o.other == null ? "1" : "0") + (o.name == null ? "1" : "0") + (o.flag == null ? "1" : "0");
}
function defaults(o: Options): string {
    return [o.count ?? -1, o.ratio ?? -2, (o.child ?? { id: -3 }).id, (o.other ?? { id: -4 }).id, o.name ?? "none", o.flag ?? "unset", o.count || -5, o.ratio || -6, o.name || "blank"].join(",");
}
function kinds(o: Options): string {
    return [typeof o.count, typeof o.ratio, typeof o.child, typeof o.other, typeof o.name, typeof o.flag].join(",");
}
function chains(o: Options): string {
    return [o.child?.id, o.other?.id, o.name?.length, o.count?.toFixed(1)].join(",");
}
function values(o: Options): string {
    return [Object.is(o.count, -0) ? "-0" : o.count, o.ratio, o.flag, "count" in o, "child" in o, Object.keys(o).length].join(",");
}
function copy(from: Options): Options {
    const to: Options = { y: from.y };
    to.count = from.count;
    to.ratio = from.ratio;
    to.child = from.child;
    to.name = from.name;
    return to;
}

for (let round = 0; round < 3; ++round) {
    for (const o of all) {
        const line = [truthiness(o), isUndefined(o), isNotUndefined(o), isNull(o), isNullish(o), defaults(o), kinds(o), chains(o), values(o)].join(" ");
        const copied = copy(o);
        if (round === 2)
            console.log(line, "|", isUndefined(copied), values(copied));
    }
}
