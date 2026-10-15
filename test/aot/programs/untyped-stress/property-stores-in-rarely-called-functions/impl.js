function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function replaces(o, v) { o.x = v; }
function replacesOutOfLine(o, v) { o.x = v; }
function replacesInPrototype(o, v) { o.x = v; }
function adds(o, v) { o.x = v; }
function storesToTwo(o, v) { o.x = v; }
function callsSetter(o, v) { o.x = v; }
function marksPrototype(o, v) { o.marker = v; }

let unique = 0;
function ordinary(name, withX) {
    const result = {};
    result[name] = 0;
    if (withX)
        result.x = -1;
    return result;
}
const changingPrototype = {};
function forgetMegamorphicCache() {
    marksPrototype(Object.create(changingPrototype), 1);
    changingPrototype["changed" + unique++] = 1;
}
const warmUp = 40;

{
    const o = ordinary("replaced", true);
    for (let i = 0; i < warmUp; i++) {
        replaces(o, i);
        check(o.x, i, "a property that is replaced");
    }
    for (let i = 0; i < 1000; i++)
        replaces(o, i);
    forgetMegamorphicCache();
    for (let i = 0; i < 100; i++) {
        replaces(o, i);
        check(o.x, i, "a property that is replaced after a prototype has changed");
    }
}

{
    const o = {};
    for (let i = 0; i < 6; i++)
        o["inline" + i] = i;
    o.x = -1;
    for (let i = 0; i < warmUp; i++) {
        replacesOutOfLine(o, i);
        check(o.x, i, "a property outside the object that is replaced");
    }
    forgetMegamorphicCache();
    for (let i = 0; i < 100; i++) {
        replacesOutOfLine(o, i);
        check(o.x + "," + o.inline5, i + ",5", "a property outside the object after a prototype has changed");
    }
}

{
    const prototype = ordinary("prototype", true);
    const inheriting = Object.create(prototype);
    for (let i = 0; i < warmUp; i++) {
        replacesInPrototype(prototype, i);
        check(inheriting.x, i, "a property of a prototype that is replaced");
    }
    forgetMegamorphicCache();
    for (let i = 0; i < 100; i++) {
        replacesInPrototype(prototype, i);
        check(inheriting.x, i, "a property of a prototype after another prototype has changed");
    }
}

{
    const name = "added";
    for (let i = 0; i < warmUp; i++) {
        const o = ordinary(name, false);
        adds(o, i);
        check(Object.keys(o).join() + o.x, name + ",x" + i, "a property that is added");
    }
    forgetMegamorphicCache();
    for (let i = 0; i < 100; i++) {
        const o = ordinary(name, false);
        adds(o, i);
        check(Object.keys(o).join() + o.x, name + ",x" + i, "a property that is added after a prototype has changed");
    }
}

{
    const first = ordinary("first", true);
    const second = ordinary("second", true);
    for (let i = 0; i < warmUp; i++) {
        storesToTwo(first, i);
        storesToTwo(second, -i);
        check(first.x + "," + second.x, i + "," + -i, "a property of two objects");
    }
    for (let i = 0; i < 100; i++) {
        storesToTwo(first, i);
        storesToTwo(second, -i);
    }
    forgetMegamorphicCache();
    for (let i = 0; i < 100; i++) {
        storesToTwo(first, i);
        storesToTwo(second, -i);
        check(first.x + "," + second.x, i + "," + -i, "a property of two objects after a prototype has changed");
    }
}

{
    let received = 0;
    const leaf = Object.create({ set x(v) { received += v; } });
    for (let i = 0; i < warmUp; i++)
        callsSetter(leaf, 1);
    for (let i = 0; i < 1000; i++)
        callsSetter(leaf, 1);
    check(received, warmUp + 1000, "what the setter has received");
}
console.log("passed");
