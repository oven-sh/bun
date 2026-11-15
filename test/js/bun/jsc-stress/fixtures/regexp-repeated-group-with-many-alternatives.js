// Whether a group keeps track of its live frame slots was asked for each of its alternatives, and the answer takes a look at
// every alternative. A group of 32,000 took 7 seconds to compile.

function shouldBe(actual, expected)
{
    if (actual !== expected)
        throw new Error(`expected ${expected} but got ${actual}`);
}

for (const [count, open, close, flags] of [[16000, "(", ")+x", ""], [2000, "(", ")+?x", ""], [2000, "(", ")+x", "i"], [2000, "(?=w)(", ")+x", ""]]) {
    const words = Array.from({ length: count }, (_, index) => "w" + index.toString(36) + ";");
    const middle = count >> 1, last = count - 1;
    const regExp = new RegExp(`(?:${words.map(word => open + word + ")").join("|")}${close}`, flags);
    const result = regExp.exec("w0;" + words[0] + words[middle] + words[last] + "x");
    shouldBe(result.index, 0);
    shouldBe(result[0].length, 3 + words[0].length + words[middle].length + words[last].length + 1);
    // Only the last iteration's capture is left.
    shouldBe(result[last + 1], words[last]);
    shouldBe(result[middle + 1], undefined);
    shouldBe(result[1], undefined);
    shouldBe(regExp.exec(words[5] + words[6] + "y"), null);
}
