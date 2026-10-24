function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function thrownBy(f) {
    try {
        return "returned " + f();
    } catch (error) {
        return error.constructor.name;
    }
}

function holdsString(flag) {
    let f = "text";
    if (flag)
        f = () => 42;
    const keep = () => f;
    const result = f();
    return result + (keep() === f ? 0 : 1);
}
check(holdsString(true), 42, "the function");
check(thrownBy(() => holdsString(false)), "TypeError", "a string");

function holdsOtherCells(which) {
    let f = which === 0 ? [1] : which === 1 ? { a: 1 } : which === 2 ? Symbol.iterator : which === 3 ? 10n ** 30n : null;
    if (which === 5)
        f = () => "called";
    const keep = () => f;
    const result = f();
    return result + typeof keep();
}
check(holdsOtherCells(5), "calledfunction", "the function");
for (let which = 0; which < 5; ++which)
    check(thrownBy(() => holdsOtherCells(which)), "TypeError", "case " + which);

function outer(k) {
    function readsScope(flag) {
        let f = "text" + k;
        if (flag)
            f = () => k * 2;
        const keep = () => f;
        const result = f();
        return result + (keep() ? 0 : 1);
    }
    return readsScope;
}
check(outer(21)(true), 42, "a function that reads its scope");
check(thrownBy(() => outer(21)(false)), "TypeError", "a string in place of a function that reads its scope");

function constructs(flag) {
    let C = "text";
    if (flag)
        C = function () { this.made = 1; };
    const keep = () => C;
    const result = new C();
    return result.made + (keep() ? 0 : 1);
}
check(constructs(true), 1, "constructed");
check(thrownBy(() => constructs(false)), "TypeError", "a string constructed");
console.log("passed");
