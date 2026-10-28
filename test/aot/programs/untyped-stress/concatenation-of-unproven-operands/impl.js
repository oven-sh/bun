(function () {
    function check(actual, expected, what) {
        if (!Object.is(actual, expected))
            throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
    }
    // What the callback returns is read: a text that nobody reads need not be made, however long it would be.
    function thrownBy(callback) {
        let result;
        try {
            result = callback();
        } catch (error) {
            return error.constructor.name;
        }
        return result === undefined ? "nothing" : "nothing, " + String(result).length + " characters";
    }

    function add(a, b) { return a + b; }
    function addToText(b) { return "<" + b; }
    function addText(a) { return a + ">"; }
    function two(a, b) { return "" + a + b; }
    function three(a, b) { return a + "/" + b; }
    function four(a, b, c) { return a + "/" + b + c; }
    function five(a, b, c) { return a + "/" + b + "/" + c; }
    function six(a, b, c, d) { return a + "/" + b + "/" + c + d; }

    const described = new Map([
        ["text", "text"], ["", ""], [0, "0"], [7, "7"], [-1, "-1"], [255, "255"], [256, "256"], [123456, "123456"], [-98765, "-98765"],
        [2147483647, "2147483647"], [-2147483648, "-2147483648"], [2147483648, "2147483648"], [1.5, "1.5"], [-0, "0"], [NaN, "NaN"],
        [true, "true"], [false, "false"], [null, "null"], [undefined, "undefined"], [12n, "12"], ["☃", "☃"],
        [{ toString() { return "object"; } }, "object"], [{ valueOf() { return 3; } }, "3"], [[1, 2], "1,2"],
    ]);
    function isText(value) { return typeof value === "string" || (typeof value === "object" && value !== null && typeof value.valueOf() !== "number"); }
    for (let round = 0; round < 3; ++round) {
        for (let [a, textOfA] of described) {
            check(addToText(a), "<" + textOfA, "text + " + textOfA);
            check(addText(a), textOfA + ">", textOfA + " + text");
            for (let [b, textOfB] of described) {
                let what = textOfA + ", " + textOfB;
                if (isText(a) || isText(b))
                    check(add(a, b), textOfA + textOfB, "add " + what);
                else {
                    let mixesBigInt = (typeof a === "bigint") !== (typeof b === "bigint");
                    check(thrownBy(() => { check(typeof add(a, b) === "string", false, "add of no text " + what); }), mixesBigInt ? "TypeError" : "nothing", "add of no text " + what);
                }
                check(two(a, b), textOfA + textOfB, "two " + what);
                check(three(a, b), textOfA + "/" + textOfB, "three " + what);
                check(four(a, b, a), textOfA + "/" + textOfB + textOfA, "four " + what);
                check(five(a, b, a), textOfA + "/" + textOfB + "/" + textOfA, "five " + what);
                check(six(a, b, a, b), textOfA + "/" + textOfB + "/" + textOfA + textOfB, "six " + what);
            }
        }
        if (typeof gc === "function")
            gc();
    }

    check(add(1, 2), 3, "Int32 + Int32");
    check(add(2147483647, 1), 2147483648, "Int32 + Int32 that overflows");
    check(add(-2147483648, -1), -2147483649, "Int32 + Int32 that underflows");
    check(add(1, 0.5), 1.5, "Int32 + double");
    check(add(1, null), 1, "Int32 + null");
    check(add(1, true), 2, "Int32 + true");
    check(add(1, undefined), NaN, "Int32 + undefined");
    check(add(1n, 2n), 3n, "BigInt + BigInt");

    check(thrownBy(() => add("text", Symbol())), "TypeError", "text + symbol");
    check(thrownBy(() => add(Symbol(), 1)), "TypeError", "symbol + Int32");
    check(thrownBy(() => three(1, Symbol())), "TypeError", "symbol as the last of three");
    check(thrownBy(() => five(Symbol(), 1, "text")), "TypeError", "symbol as the first of five");

    let order = [];
    function logged(name) { return { valueOf() { order.push(name); return name; } }; }
    check(five(logged("a"), logged("b"), logged("c")), "a/b/c", "objects");
    check(order.join(), "a,b,c", "the order of conversions");

    let long = "x";
    for (let i = 0; i < 30; ++i)
        long = long + long;
    check(thrownBy(() => add(long, long)), "RangeError", "a sum that is too long");
    check(thrownBy(() => three(long, long)), "RangeError", "three that are too long");
    check(thrownBy(() => five(long, 1, long)), "RangeError", "five that are too long");
    check(thrownBy(() => five(long, long, Symbol())), "RangeError", "too long before the symbol is reached");
    check(add(long, "").length, 1 << 30, "a long text and an empty one");
    check(three("", "").length, 1, "two empty texts");
    check(two("", ""), "", "only empty texts");

    function provenInLoop(n) {
        let text = "";
        for (let i = 0; i < n; ++i)
            text = text + "ab";
        return text.length;
    }
    function threeInLoop(list) {
        let total = 0;
        for (let i = 0; i < list.length; ++i)
            total += (list[i] + "/" + list[i]).length;
        return total;
    }
    function sixInLoop(list) {
        let total = 0;
        for (let i = 0; i < list.length; ++i)
            total += (list[i] + "/" + list[i] + "/" + list[i] + list[i]).length;
        return total;
    }
    function addToTextInLoop(list) {
        let total = 0;
        for (let i = 0; i < list.length; ++i)
            total += ("<" + list[i]).length;
        return total;
    }
    function subtractFromTextInLoop(list) {
        let total = 0;
        for (let i = 0; i < list.length; ++i)
            total += "9" - list[i];
        return total;
    }
    function addsNoTextInLoop(n) {
        let total = 0;
        for (let i = 0; i < n; ++i)
            total += ((i > 2) + null) | 0;
        return total;
    }
    const mixed = ["text", 1, "", -20, 300000, 1.5, null, "☃"];
    check(provenInLoop(5), 10, "proven strings in a loop");
    const lengthOfAll = mixed.map(String).join("").length;
    check(threeInLoop(mixed), 2 * lengthOfAll + mixed.length, "three in a loop");
    check(sixInLoop(mixed), 4 * lengthOfAll + 2 * mixed.length, "six in a loop");
    check(addToTextInLoop(mixed), lengthOfAll + mixed.length, "text + unknown in a loop");
    check(subtractFromTextInLoop([1, "2", 3]), 21, "text - unknown in a loop");
    check(addsNoTextInLoop(5), 2, "boolean + null in a loop");
})();
console.log("passed");
