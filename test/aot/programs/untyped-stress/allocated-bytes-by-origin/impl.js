function shouldBe(actual, expected, what)
{
    if (actual !== expected)
        throw new Error(what + ": " + actual + " instead of " + expected);
}

(function () {

    const holder = [null];

    for (let i = 0; i < 400000; ++i)
        holder[0] = { first: i, second: i, third: i, fourth: i };
    shouldBe(holder[0].fourth, 399999, "the last object");

    for (let i = 0; i < 40; ++i) {
        const array = new Array(90000);
        array.fill(i);
        holder[0] = array;
    }
    shouldBe(holder[0][89999], 39, "the last array");

    let characters = 0;
    for (let i = 0; i < 40; ++i) {
        holder[0] = ("x" + i).repeat(200000);
        characters += holder[0].charCodeAt(0);
    }
    shouldBe(characters, 40 * 120, "the strings");

    let byteLength = 0;
    for (let i = 0; i < 40; ++i) {
        holder[0] = new ArrayBuffer(500000);
        byteLength += holder[0].byteLength;
    }
    shouldBe(byteLength, 20000000, "the buffers");

    fullGC();
    edenGC();

    holder[0] = null;
    fullGC();
    const kept = [];
    for (let i = 0; i < 200000; ++i)
        kept.push({ first: i, second: i, third: i, fourth: i });
    fullGC();
    shouldBe(kept[199999].fourth, 199999, "the last object that is kept");
    kept.length = 0;
    fullGC();
})();
console.log("passed");
