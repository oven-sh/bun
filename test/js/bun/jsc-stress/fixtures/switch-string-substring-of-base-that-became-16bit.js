function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error("expected " + expected + " but got " + actual);
}

function which(string) {
    switch (string) {
    case "ert":
        return 1;
    case "abc":
        return 2;
    case "xyz":
        return 3;
    default:
        return 0;
    }
}
noInline(which);

function substringOfBaseThatBecame16Bit(i) {
    const keys = {};
    const wide = ("qwertyuiop" + i + "☃").slice(0, -1);
    Symbol(wide);
    keys[wide] = 1;
    const narrow = ("QWERTYUIOP" + i).toLowerCase();
    const part = narrow.slice(2, 5);
    shouldBe(keys[narrow], 1);
    return part;
}
noInline(substringOfBaseThatBecame16Bit);

for (let i = 0; i < testLoopCount * 10; ++i)
    shouldBe(which(substringOfBaseThatBecame16Bit(i)), 1);
