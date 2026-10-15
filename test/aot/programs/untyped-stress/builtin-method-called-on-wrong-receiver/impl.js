function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error(`expected ${String(expected)} but got ${String(actual)}`);
}

function shouldThrowTypeError(func) {
    let error;
    try {
        func();
    } catch (e) {
        error = e;
    }
    if (!(error instanceof TypeError))
        throw new Error(`expected a TypeError but got ${String(error)}`);
}

for (let i = 0; i < 100; ++i) {
    shouldBe(String.prototype.trim.call(123), "123");
    shouldBe(String.prototype.toUpperCase.call(true), "TRUE");
    shouldBe(String.prototype.indexOf.call(12345, "34"), 2);
    shouldBe(String.prototype.slice.call(12345, 1, 3), "23");
    shouldBe(String.prototype.startsWith.call(12345, "12"), true);
    shouldBe(String.prototype.concat.call(1, "2"), "12");
    shouldBe(String.prototype.split.call(102, "0").length, 2);
    shouldBe(Array.prototype.join.call({ length: 2, 0: "a", 1: "b" }, "-"), "a-b");
    shouldBe(Array.prototype.join.call("abc", "-"), "a-b-c");
    shouldBe(Array.prototype.indexOf.call("abc", "b"), 1);
    shouldBe(Array.prototype.includes.call({ length: 1, 0: 7 }, 7), true);
    shouldBe(Array.prototype.shift.call({ length: 1, 0: "x" }), "x");
    shouldBe(Array.prototype.unshift.call({ length: 0 }, 1), 1);
    shouldBe(Array.prototype.push.call({ length: 0 }, 1, 2), 2);
    shouldBe(Array.prototype.slice.call("abc", 1).length, 2);
    shouldThrowTypeError(() => Array.prototype.shift.call("abc"));
    shouldThrowTypeError(() => Array.prototype.unshift.call("abc", 1));
    shouldThrowTypeError(() => String.prototype.trim.call(null));
    shouldThrowTypeError(() => String.prototype.trim.call(undefined));

    for (const receiver of [{}, [], "s", 1, null, undefined, new Set, new WeakMap]) {
        shouldThrowTypeError(() => Map.prototype.get.call(receiver, 1));
        shouldThrowTypeError(() => Map.prototype.has.call(receiver, 1));
        shouldThrowTypeError(() => Map.prototype.set.call(receiver, 1, 1));
        shouldThrowTypeError(() => Date.prototype.getTime.call(receiver));
        shouldThrowTypeError(() => Date.prototype.getFullYear.call(receiver));
        shouldThrowTypeError(() => RegExp.prototype.exec.call(receiver, "a"));
    }
    for (const receiver of [{}, [], "s", 1, null, undefined, new Map, new WeakSet]) {
        shouldThrowTypeError(() => Set.prototype.has.call(receiver, 1));
        shouldThrowTypeError(() => Set.prototype.add.call(receiver, 1));
        shouldThrowTypeError(() => WeakMap.prototype.get.call(receiver, {}));
    }
    shouldThrowTypeError(() => Number.prototype.toString.call("1"));
    shouldThrowTypeError(() => Number.prototype.toFixed.call({}, 1));

    shouldBe(Array.prototype.shift.call([5, 6]), 5);
    shouldBe(String.prototype.trim.call(" a "), "a");
    shouldBe(Map.prototype.get.call(new Map([[1, 2]]), 1), 2);
    shouldBe(Set.prototype.has.call(new Set([1]), 1), true);
    shouldBe(Date.prototype.getTime.call(new Date(5)), 5);
    shouldBe(Number.prototype.toString.call(5), "5");
}
console.log("passed");
