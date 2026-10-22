// A typed array may have more than 2 ** 31 elements, so a negative int32 key must not be taken for an index near its end: it reads `undefined`, and a store under it does nothing.
function read(base: any, key: any): any { return base[key]; }
function store(base: any, key: any, value: any): void { base[key] = value; }
function report(label: string, base: any, keys: number[]): void {
  console.log(label + ": " + keys.map(key => key + " -> " + read(base, key)).join(", "));
}

report("an array", [1, 2], [0, -1]);
report("a string", "ab", [0, -1]);
report("2 elements", new Uint8Array(2), [0, -1]);

const huge: any = new Uint8Array(2 ** 32);
const hugeKeys = [0, -1, -2, -2147483648, 2147483647, 2147483648, 4294967294, 4294967295, 4294967296];
report("4294967296 elements", huge, hugeKeys);
store(huge, -1, 7);
store(huge, -2, 7);
store(huge, -2147483648, 7);
store(huge, 4294967296, 7);
report("after stores outside", huge, hugeKeys);
store(huge, 4294967295, 8);
store(huge, 2147483648, 9);
report("after stores inside", huge, hugeKeys);
console.log(huge[-1], huge[-2147483648], huge[2147483648], huge[4294967295], huge[4294967296]);
console.log(Object.hasOwn(huge, "-1"), Object.hasOwn(huge, "4294967295"), Object.hasOwn(huge, "4294967296"), huge.length);
