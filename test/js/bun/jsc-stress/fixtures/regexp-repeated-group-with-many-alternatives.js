// Whether a group keeps track of its live frame slots was asked for each of its alternatives, and the answer takes a look at
// every alternative. A group of 32,000 took 7 seconds to compile.

function shouldBe(actual, expected)
{
    if (actual !== expected)
        throw new Error(`expected ${expected} but got ${actual}`);
}

const words = Array.from({ length: 24000 }, (_, index) => "w" + index.toString(36) + ";");

for (const [open, close, flags] of [["(", ")+x", ""], ["(", ")+?x", ""], ["(", ")+x", "i"], ["(?=w)(", ")+x", ""]]) {
    const regExp = new RegExp(`(?:${words.map(word => open + word + ")").join("|")}${close}`, flags);
    const result = regExp.exec("w0;" + words[0] + words[12000] + words[23999] + "x");
    shouldBe(result.index, 0);
    shouldBe(result[0].length, 3 + words[0].length + words[12000].length + words[23999].length + 1);
    // Only the last iteration's capture is left.
    shouldBe(result[24000], words[23999]);
    shouldBe(result[12001], undefined);
    shouldBe(result[1], undefined);
    shouldBe(regExp.exec(words[5] + words[6] + "y"), null);
}
