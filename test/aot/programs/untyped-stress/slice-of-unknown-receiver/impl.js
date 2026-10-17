(function () {
    function check(actual, expected, what) {
        if (!Object.is(actual, expected))
            throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
    }

    function sliceFrom(x, start) { return x.slice(start); }
    function sliceWithEnd(x, start, end) { return x.slice(start, end); }
    function sliceAll(x) { return x.slice(); }
    function sliceWithMore(x, start, end) { return x.slice(start, end, 1); }
    function sliceOfArray(n) { return [n, n + 1, n + 2].slice(1).length; }
    function sliceOfText(n) { return ("text" + n).slice(1, 3); }
    function sliceIgnored(x, start) { x.slice(start); return 1; }
    function sliceWithoutReceiver(x) { let slice = x.slice; try { return slice(1); } catch (error) { return error.constructor.name; } }

    function toInteger(value) {
        let number = Number(value);
        return number !== number ? 0 : Math.trunc(number);
    }
    function expected(text, start, end) {
        let length = text.length;
        let from = toInteger(start);
        let to = end === undefined ? length : toInteger(end);
        from = from < 0 ? Math.max(length + from, 0) : Math.min(from, length);
        to = to < 0 ? Math.max(length + to, 0) : Math.min(to, length);
        let result = "";
        for (let i = from; i < to; ++i)
            result += text[i];
        return result;
    }

    const half = "a rope of two ";
    const texts = ["", "x", "hello, world", "a text of more than sixteen characters", "sn☃wman and friends", half + ["halves"][0], "0123456789abcdefghij".slice(3, 19)];
    const positions = [0, 1, 2, 5, 12, 100, -1, -2, -5, -100, 2147483647, -2147483648, 1.5, -1.5, NaN, Infinity, -Infinity, 4294967296, undefined, null, true, "2", "-3", "x", { valueOf() { return 2; } }];
    for (let round = 0; round < 2; ++round) {
        for (let text of texts) {
            check(sliceAll(text), text, "no argument");
            for (let start of positions) {
                check(sliceFrom(text, start), expected(text, start, undefined), JSON.stringify(text) + ".slice(" + String(start) + ")");
                check(sliceIgnored(text, start), 1, "the result is not used");
                for (let end of positions) {
                    check(sliceWithEnd(text, start, end), expected(text, start, end), JSON.stringify(text) + ".slice(" + String(start) + ", " + String(end) + ")");
                    check(sliceWithMore(text, start, end), expected(text, start, end), "three arguments");
                }
            }
        }
    }

    check(sliceFrom([1, 2, 3], 1).join(), "2,3", "an array");
    check(sliceWithEnd([1, 2, 3, 4], 1, 3).join(), "2,3", "an array, with an end");
    check(sliceWithEnd(new Uint8Array([1, 2, 3, 4]), 1, -1).join(), "2,3", "a typed array");
    check(sliceFrom(new String("object"), 2), "ject", "a String object");
    check(sliceWithEnd({ slice(start, end) { return this.base + start + end; }, base: 10 }, 1, 2), 13, "a method of the program");
    check(sliceFrom({ slice: Array.prototype.slice, length: 2, 0: "a", 1: "b" }, 1).join(), "b", "the method of arrays on another object");
    check(sliceFrom({ slice: String.prototype.slice, toString() { return "converted"; } }, 3), "verted", "the method of strings on an object");
    check(sliceWithoutReceiver("text"), "TypeError", "the method of strings without a receiver");
    check(sliceWithoutReceiver({ slice(start) { return start + 1; } }), 2, "a method of the program without a receiver");
    for (let nothing of [undefined, null]) {
        let thrown = "nothing";
        try {
            sliceFrom(nothing, 1);
        } catch (error) {
            thrown = error.constructor.name;
        }
        check(thrown, "TypeError", "no receiver");
    }
    check(sliceOfArray(1), 2, "an array literal");
    check(sliceOfText(5), "ex", "a proven string");

    function readsAround(o, x, start) {
        let before = o.p;
        let sliced = x.slice(start);
        return before + ":" + o.p + ":" + sliced;
    }
    let observed = { p: 1 };
    check(readsAround(observed, "text", 1), "1:1:ext", "nothing changes");
    check(readsAround(observed, { slice() { observed.p = 2; return "z"; } }, 1), "1:2:z", "a method of the program stores");
    check(readsAround(observed, "text", { valueOf() { observed.p = 3; return 2; } }), "2:3:xt", "the conversion of an argument stores");
    check(readsAround(observed, "text", 3), "3:3:t", "nothing changes again");

    let order = [];
    check(sliceWithEnd("ordered", { valueOf() { order.push("start"); return 1; } }, { valueOf() { order.push("end"); return 3; } }), "rd", "both arguments are objects");
    check(order.join(), "start,end", "the order of conversions");
})();
console.log("passed");
