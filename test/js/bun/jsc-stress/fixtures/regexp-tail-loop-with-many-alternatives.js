// The pass that lets a tail loop match a run of characters compared each alternative with the first characters of all the earlier
// ones, so a loop of N alternatives took N * N steps to compile: 36 seconds for 95,000. It also went through every code point
// of a class: 4 milliseconds for each [\S]. Now it goes through ranges, and stops when it has spent what it may.

function shouldBe(actual, expected)
{
    if (actual !== expected)
        throw new Error(`expected ${expected} but got ${actual}`);
}

const character = index => String.fromCharCode(0x400 + 2 * index);

// A two-character alternative between the classes keeps them from being merged into one class.
function tailLoop(count, descending)
{
    const alternatives = [];
    for (let i = 0; i < count; ++i)
        alternatives.push(`[${character(descending ? count - 1 - i : i)}]`, "xy");
    return new RegExp(`(?:${alternatives.join("|")})*`);
}

// What matches is the same whether the pass gets to the end of the loop, which it does up to about 90 classes, or not.
for (const count of [3, 50, 80, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 100, 500, 2000, 25000]) {
    for (const descending of count > 2000 ? [true] : [false, true]) {
        const regExp = tailLoop(count, descending);
        const first = character(0), last = character(count - 1), middle = character(count >> 1), outside = character(count);
        shouldBe(regExp.exec(first + first + "xy" + last + last + last + middle + "xy" + outside)[0].length, 10);
        shouldBe(regExp.exec(last.repeat(50) + "x" + last)[0].length, 50);
        shouldBe(regExp.exec(middle + "xyxy" + first.repeat(20) + "yx")[0].length, 25);
        shouldBe(regExp.exec(outside + first)[0].length, 0);
        shouldBe(regExp.exec("")[0].length, 0);
    }
}

// A class of a million code points costs no more than a small one, and one of 700 ranges not much more.
for (const [characterClass, flags] of [["[\\S]", ""], ["[\\S]", "u"], ["[\\u0100-\\uffff]", ""], ["[\\u{100}-\\u{10ffff}]", "u"], ["\\p{L}", "u"]]) {
    const regExp = new RegExp(`(?:${new Array(10000).fill(characterClass + "|xy").join("|")})*`, flags);
    shouldBe(regExp.exec("\u4e2d\u4e2dxy\u4e2d \u4e2d")[0].length, 5);
}

// What is left of a wide class after the alternatives before it.
shouldBe(/(?:ab|[\S]|  )*/.exec("abaab  cab a")[0].length, 10);
shouldBe(/(?:\u4e2dx|[\u0100-\uffff]|y)*/.exec("\u4e2dx\u4e2d\u4e2dy\u4e2dxx")[0].length, 7);
shouldBe(/(?:\u{1f600}x|[\u{100}-\u{10ffff}]|y)*/u.exec("\u{1f600}x\u{1f600}\u{1f600}y\u{1f600}xx")[0].length, 11);
shouldBe(/(?:[a-c]|[\S]|  )*/.exec("abcxyz  cba z")[0].length, 11);
