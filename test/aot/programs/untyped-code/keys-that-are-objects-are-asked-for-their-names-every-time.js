let asked = 0;
const key = { toString() { asked++; return "error"; } };
const make = i => ({ error: i, page: i, call() { return 1; } });
const callable = { toString() { asked++; return "call"; } };
class Base { error() { return 1; } }
class Heir extends Base { viaSuper(k) { return super[k]; } }
const ways = {
    hasOwnProperty: o => o.hasOwnProperty(key),
    hasOwn: o => Object.hasOwn(o, key),
    in: o => key in o,
    reflectHas: o => Reflect.has(o, key),
    reflectGet: o => Reflect.get(o, key),
    reflectSet: o => Reflect.set(o, key, 1),
    reflectDelete: o => Reflect.deleteProperty(o, key),
    enumerable: o => o.propertyIsEnumerable(key),
    descriptor: o => Object.getOwnPropertyDescriptor(o, key),
    define: o => Object.defineProperty(o, key, { value: 1 }),
    destructure: o => { const { [key]: x } = o; return x; },
    rest: o => { const { [key]: x, ...others } = o; return others; },
    increment: o => o[key]++,
    assignAdd: o => o[key] += 1,
    coalesce: o => o[key] ??= 1,
    call: o => o[callable](),
    literal: o => ({ [key]: 1 }),
    classMember: o => class { [key]() { } },
    classField: o => new (class { [key] = 1; })(),
    viaSuper: o => new Heir().viaSuper(key),
    optional: o => o?.[key],
    typeOf: o => typeof o[key],
    deleteOptional: o => delete o?.[key],
    getter: o => ({ get [key]() { return 1; } }),
    lookupGetter: o => o.__lookupGetter__(key),
    mapGet: o => new Map([["error", 1]]).get(key),
};
for (const [label, way] of Object.entries(ways)) {
    asked = 0;
    for (let i = 0; i < 60; i++) way(make(i));
    console.log(label, asked);
}
