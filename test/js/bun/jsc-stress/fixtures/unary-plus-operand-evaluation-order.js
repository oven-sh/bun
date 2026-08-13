// The parser used to drop the unary plus from the operands of `*`, `/`, `%` and `-` because those
// operators convert their operands anyway. That changed observable behavior: `+x` converts x while
// the operand is evaluated, before the other operand runs, and it throws for BigInts, whereas the
// operators convert both operands only after evaluating both, and accept BigInts.
// https://bugs.webkit.org/show_bug.cgi?id=159968

function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error(`bad value: ${String(actual)}, expected ${String(expected)}`);
}

function shouldThrow(func, errorType) {
    let error;
    try {
        func();
    } catch (e) {
        error = e;
    }
    if (!(error instanceof errorType))
        throw new Error(`${func} should have thrown a ${errorType.name}, got ${String(error)}`);
    return error;
}

// The shape from the original report, without any parentheses.
{
    const log = [];
    const left = { valueOf() { log.push("left.valueOf"); return 2; } };
    function right() { log.push("right()"); return 3; }
    shouldBe(+left * right(), 6);
    shouldBe(log.join(), "left.valueOf,right()");
}

// `**` never dropped the unary plus (see pow-evaluation-order.js); it is included to pin the shared code path.
for (const op of ["*", "/", "%", "-", "**"]) {
    const expected = eval(`6 ${op} 3`);

    // `+left op right()`: left is converted before right() is called.
    {
        const log = [];
        const left = { valueOf() { log.push("left.valueOf"); return 6; } };
        const right = () => { log.push("right()"); return 3; };
        shouldBe(new Function("left", "right", `return (+left) ${op} right();`)(left, right), expected);
        shouldBe(log.join(), "left.valueOf,right()");
    }

    // `left op +right`: the unary plus converts right before the operator converts left.
    {
        const log = [];
        const left = { valueOf() { log.push("left.valueOf"); return 6; } };
        const right = { valueOf() { log.push("right.valueOf"); return 3; } };
        shouldBe(new Function("left", "right", `return left ${op} (+right);`)(left, right), expected);
        shouldBe(log.join(), "right.valueOf,left.valueOf");
    }

    // When both operands would throw, the unary plus's conversion throws first and right() never runs.
    {
        let rightCalled = false;
        const left = { valueOf() { throw new RangeError("left"); } };
        const right = () => { rightCalled = true; throw new Error("right"); };
        const error = shouldThrow(() => new Function("left", "right", `return (+left) ${op} right();`)(left, right), RangeError);
        shouldBe(error.message, "left");
        shouldBe(rightCalled, false);
    }

    // Unary plus throws for BigInts even though the operator itself accepts them.
    shouldBe(new Function(`return 6n ${op} 3n;`)(), BigInt(expected));
    shouldThrow(() => new Function("a", "b", `return (+a) ${op} b;`)(6n, 3n), TypeError);
    shouldThrow(() => new Function("a", "b", `return a ${op} (+b);`)(6n, 3n), TypeError);
    shouldThrow(() => new Function("a", "b", `return (+a) ${op} (+b);`)(6n, 3n), TypeError);
    shouldThrow(new Function(`return (+6n) ${op} 3n;`), TypeError);
    shouldThrow(new Function(`return 6n ${op} (+3n);`), TypeError);
    shouldThrow(() => new Function("a", `return (+a) ${op} 3;`)({ valueOf() { return 6n; } }), TypeError);

    // A unary plus on a number literal is a no-op, so the literal operands still fold to the same value.
    shouldBe(new Function(`return (+6) ${op} 3;`)(), expected);
    shouldBe(new Function(`return 6 ${op} (+3);`)(), expected);
    shouldBe(new Function(`return (+6) ${op} (+3);`)(), expected);
    shouldBe(new Function(`return (+6.0) ${op} (+3.0);`)(), expected);
    shouldBe(new Function("a", "b", `return (+a) ${op} (+b);`)("6", "3"), expected);
    shouldBe(new Function("a", "b", `return (+a) ${op} b;`)("6", "3"), expected);
}

// `x * 1` and `1 * x` become a plain ToNumber(x); a unary plus already on x must not make it convert twice or change the result.
{
    let conversions = 0;
    const x = { valueOf() { ++conversions; return 7; } };
    shouldBe(new Function("x", "return (+x) * 1;")(x), 7);
    shouldBe(new Function("x", "return 1 * (+x);")(x), 7);
    shouldBe(new Function("x", "return x * 1;")(x), 7);
    shouldBe(new Function("x", "return 1 * x;")(x), 7);
    shouldBe(conversions, 4);
    shouldThrow(() => new Function("x", "return (+x) * 1;")(7n), TypeError);
    shouldThrow(() => new Function("x", "return 1 * (+x);")(7n), TypeError);
    shouldBe(new Function("return (+7) * 1;")(), 7);
    shouldBe(new Function("return 1 * (+7);")(), 7);
}

// The order must survive the optimizing tiers.
{
    const log = [];
    const left = { valueOf() { log.push("left.valueOf"); return 6; } };
    const right = () => { log.push("right()"); return 3; };

    function multiply(left, right) { return +left * right(); }
    noInline(multiply);
    function divide(left, right) { return +left / right(); }
    noInline(divide);
    function remainder(left, right) { return +left % right(); }
    noInline(remainder);
    function subtract(left, right) { return +left - right(); }
    noInline(subtract);

    for (let i = 0; i < testLoopCount; ++i) {
        log.length = 0;
        shouldBe(multiply(left, right), 18);
        shouldBe(divide(left, right), 2);
        shouldBe(remainder(left, right), 0);
        shouldBe(subtract(left, right), 3);
        shouldBe(log.join(), "left.valueOf,right(),left.valueOf,right(),left.valueOf,right(),left.valueOf,right()");
    }
}
