function read(o) { return o.p; }
function write(o, v) { o.p = v; }
noInline(read);
noInline(write);

function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error("bad value: " + actual + ", expected " + expected);
}

let unique = 0;
function fresh(before, value) {
    const o = { };
    o["u" + unique++] = 0;
    for (let i = 0; i < before; i++)
        o["f" + i] = -1;
    o.p = value;
    return o;
}
function freshWithOneNewStructure(value) {
    const o = { };
    o.p = value;
    o["u" + unique++] = 0;
    return o;
}
function structureID(o) { return /StructureID: (\d+)/.exec(describe(o))[1]; }

read({ p: 1 });
write({ p: 1 }, 1);
fullGC();
fullGC();

let reused = [0, 0];
for (let round = 0; round < 40; round++) {
    let id = (function () {
        const o = fresh(round & 1 ? 40 : 5, round);
        for (let i = 0; i < 3; i++) {
            shouldBe(read(o), round);
            write(o, round);
        }
        return structureID(o);
    })();
    edenGC();
    for (let i = 0; i < 4000; i++) {
        const o = freshWithOneNewStructure(i);
        if (structureID(o) !== id)
            continue;
        reused[round & 1]++;
        shouldBe(read(o), i);
        write(o, i + 1);
        shouldBe(o.p, i + 1);
        break;
    }
}
console.log("passed");
