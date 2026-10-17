function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

const kept = [];
function keep(o) { kept.push(o); return o; }
noInline(keep);
function Item(tag, key, child) {
    this.tag = tag;
    this.key = key;
    this.child = child;
}
const makeItem = which => keep(new Item(which, which + 1, which + 2));

function dense(x, y, z) {
    return x.tag + y.key + z.child;
}
function sparse(x, y, z, n) {
    let total = x.tag + y.key + z.child;
    total = (total * 3 + n) % 1009; total = (total * 5 + n) % 1013; total = (total * 7 + n) % 1019; total = (total * 11 + n) % 1021;
    total = (total * 13 + n) % 1031; total = (total * 17 + n) % 1033; total = (total * 19 + n) % 1039; total = (total * 23 + n) % 1049;
    total = (total * 29 + n) % 1051; total = (total * 31 + n) % 1061; total = (total * 37 + n) % 1063; total = (total * 41 + n) % 1069;
    total = (total * 43 + n) % 1087; total = (total * 47 + n) % 1091; total = (total * 53 + n) % 1093; total = (total * 59 + n) % 1097;
    total = (total * 61 + n) % 1103; total = (total * 67 + n) % 1109; total = (total * 71 + n) % 1117; total = (total * 73 + n) % 1123;
    total = (total * 79 + n) % 1129; total = (total * 83 + n) % 1151; total = (total * 89 + n) % 1153; total = (total * 97 + n) % 1163;
    return total;
}
noInline(dense);
noInline(sparse);
function reference(total, n) {
    let factors = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];
    let moduli = [1009, 1013, 1019, 1021, 1031, 1033, 1039, 1049, 1051, 1061, 1063, 1069, 1087, 1091, 1093, 1097, 1103, 1109, 1117, 1123, 1129, 1151, 1153, 1163];
    for (let i = 0; i < factors.length; ++i)
        total = (total * factors[i] + n) % moduli[i];
    return total;
}
for (let i = 0; i < 200; ++i) {
    let x = makeItem(i), y = makeItem(10), z = makeItem(20);
    check(dense(x, y, z), i + 33, "dense");
    check(sparse(x, y, z, i), reference(i + 33, i), "sparse");
}
console.log("passed");
