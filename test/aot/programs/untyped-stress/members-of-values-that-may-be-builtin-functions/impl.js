const failures = [];

function check(actual, expected, what)
{
    if (!Object.is(actual, expected))
        failures.push(what + ": " + String(actual) + " instead of " + String(expected));
}

function outcomeOf(run)
{
    try {
        return run();
    } catch (error) {
        return error.constructor.name;
    }
}

function test()
{
    const symbol = Symbol("s");
    const plainObject = { };
    const objectWithItsOwn = { call: 0, apply: 0, bind: 0, toFixed: 0, toString: 0, trim: 0, valueOf: 0 };
    function programFunction() { }
    function programFunctionWithItsOwn() { }
    programFunctionWithItsOwn.call = 0;
    programFunctionWithItsOwn.apply = 0;
    programFunctionWithItsOwn.bind = 0;

    function functionOrInt32(c) { return c ? 5 : Math.floor; }
    function hasCallOfInt32(c) { var g = functionOrInt32(c); return g.call ? "yes" : "no"; }
    function kindOfCallOfInt32(c) { var g = functionOrInt32(c); return typeof g.call; }
    function isCallOfInt32(c) { var g = functionOrInt32(c); return g.call === Function.prototype.call; }
    function lacksCallOfInt32(c) { var g = functionOrInt32(c); return g.call === undefined; }
    function hasApplyOfInt32(c) { var g = functionOrInt32(c); return g.apply ? "yes" : "no"; }
    function kindOfApplyOfInt32(c) { var g = functionOrInt32(c); return typeof g.apply; }
    function isApplyOfInt32(c) { var g = functionOrInt32(c); return g.apply === Function.prototype.apply; }
    function lacksApplyOfInt32(c) { var g = functionOrInt32(c); return g.apply === undefined; }
    function hasBindOfInt32(c) { var g = functionOrInt32(c); return g.bind ? "yes" : "no"; }
    function kindOfBindOfInt32(c) { var g = functionOrInt32(c); return typeof g.bind; }
    function isBindOfInt32(c) { var g = functionOrInt32(c); return g.bind === Function.prototype.bind; }
    function lacksBindOfInt32(c) { var g = functionOrInt32(c); return g.bind === undefined; }
    function functionOrDouble(c) { return c ? 0.5 : Math.floor; }
    function hasCallOfDouble(c) { var g = functionOrDouble(c); return g.call ? "yes" : "no"; }
    function kindOfCallOfDouble(c) { var g = functionOrDouble(c); return typeof g.call; }
    function isCallOfDouble(c) { var g = functionOrDouble(c); return g.call === Function.prototype.call; }
    function lacksCallOfDouble(c) { var g = functionOrDouble(c); return g.call === undefined; }
    function hasApplyOfDouble(c) { var g = functionOrDouble(c); return g.apply ? "yes" : "no"; }
    function kindOfApplyOfDouble(c) { var g = functionOrDouble(c); return typeof g.apply; }
    function isApplyOfDouble(c) { var g = functionOrDouble(c); return g.apply === Function.prototype.apply; }
    function lacksApplyOfDouble(c) { var g = functionOrDouble(c); return g.apply === undefined; }
    function hasBindOfDouble(c) { var g = functionOrDouble(c); return g.bind ? "yes" : "no"; }
    function kindOfBindOfDouble(c) { var g = functionOrDouble(c); return typeof g.bind; }
    function isBindOfDouble(c) { var g = functionOrDouble(c); return g.bind === Function.prototype.bind; }
    function lacksBindOfDouble(c) { var g = functionOrDouble(c); return g.bind === undefined; }
    function functionOrString(c) { return c ? "s" : Math.floor; }
    function hasCallOfString(c) { var g = functionOrString(c); return g.call ? "yes" : "no"; }
    function kindOfCallOfString(c) { var g = functionOrString(c); return typeof g.call; }
    function isCallOfString(c) { var g = functionOrString(c); return g.call === Function.prototype.call; }
    function lacksCallOfString(c) { var g = functionOrString(c); return g.call === undefined; }
    function hasApplyOfString(c) { var g = functionOrString(c); return g.apply ? "yes" : "no"; }
    function kindOfApplyOfString(c) { var g = functionOrString(c); return typeof g.apply; }
    function isApplyOfString(c) { var g = functionOrString(c); return g.apply === Function.prototype.apply; }
    function lacksApplyOfString(c) { var g = functionOrString(c); return g.apply === undefined; }
    function hasBindOfString(c) { var g = functionOrString(c); return g.bind ? "yes" : "no"; }
    function kindOfBindOfString(c) { var g = functionOrString(c); return typeof g.bind; }
    function isBindOfString(c) { var g = functionOrString(c); return g.bind === Function.prototype.bind; }
    function lacksBindOfString(c) { var g = functionOrString(c); return g.bind === undefined; }
    function functionOrBoolean(c) { return c ? true : Math.floor; }
    function hasCallOfBoolean(c) { var g = functionOrBoolean(c); return g.call ? "yes" : "no"; }
    function kindOfCallOfBoolean(c) { var g = functionOrBoolean(c); return typeof g.call; }
    function isCallOfBoolean(c) { var g = functionOrBoolean(c); return g.call === Function.prototype.call; }
    function lacksCallOfBoolean(c) { var g = functionOrBoolean(c); return g.call === undefined; }
    function hasApplyOfBoolean(c) { var g = functionOrBoolean(c); return g.apply ? "yes" : "no"; }
    function kindOfApplyOfBoolean(c) { var g = functionOrBoolean(c); return typeof g.apply; }
    function isApplyOfBoolean(c) { var g = functionOrBoolean(c); return g.apply === Function.prototype.apply; }
    function lacksApplyOfBoolean(c) { var g = functionOrBoolean(c); return g.apply === undefined; }
    function hasBindOfBoolean(c) { var g = functionOrBoolean(c); return g.bind ? "yes" : "no"; }
    function kindOfBindOfBoolean(c) { var g = functionOrBoolean(c); return typeof g.bind; }
    function isBindOfBoolean(c) { var g = functionOrBoolean(c); return g.bind === Function.prototype.bind; }
    function lacksBindOfBoolean(c) { var g = functionOrBoolean(c); return g.bind === undefined; }
    function functionOrSymbol(c) { return c ? symbol : Math.floor; }
    function hasCallOfSymbol(c) { var g = functionOrSymbol(c); return g.call ? "yes" : "no"; }
    function kindOfCallOfSymbol(c) { var g = functionOrSymbol(c); return typeof g.call; }
    function isCallOfSymbol(c) { var g = functionOrSymbol(c); return g.call === Function.prototype.call; }
    function lacksCallOfSymbol(c) { var g = functionOrSymbol(c); return g.call === undefined; }
    function hasApplyOfSymbol(c) { var g = functionOrSymbol(c); return g.apply ? "yes" : "no"; }
    function kindOfApplyOfSymbol(c) { var g = functionOrSymbol(c); return typeof g.apply; }
    function isApplyOfSymbol(c) { var g = functionOrSymbol(c); return g.apply === Function.prototype.apply; }
    function lacksApplyOfSymbol(c) { var g = functionOrSymbol(c); return g.apply === undefined; }
    function hasBindOfSymbol(c) { var g = functionOrSymbol(c); return g.bind ? "yes" : "no"; }
    function kindOfBindOfSymbol(c) { var g = functionOrSymbol(c); return typeof g.bind; }
    function isBindOfSymbol(c) { var g = functionOrSymbol(c); return g.bind === Function.prototype.bind; }
    function lacksBindOfSymbol(c) { var g = functionOrSymbol(c); return g.bind === undefined; }
    function functionOrBigInt(c) { return c ? 5n : Math.floor; }
    function hasCallOfBigInt(c) { var g = functionOrBigInt(c); return g.call ? "yes" : "no"; }
    function kindOfCallOfBigInt(c) { var g = functionOrBigInt(c); return typeof g.call; }
    function isCallOfBigInt(c) { var g = functionOrBigInt(c); return g.call === Function.prototype.call; }
    function lacksCallOfBigInt(c) { var g = functionOrBigInt(c); return g.call === undefined; }
    function hasApplyOfBigInt(c) { var g = functionOrBigInt(c); return g.apply ? "yes" : "no"; }
    function kindOfApplyOfBigInt(c) { var g = functionOrBigInt(c); return typeof g.apply; }
    function isApplyOfBigInt(c) { var g = functionOrBigInt(c); return g.apply === Function.prototype.apply; }
    function lacksApplyOfBigInt(c) { var g = functionOrBigInt(c); return g.apply === undefined; }
    function hasBindOfBigInt(c) { var g = functionOrBigInt(c); return g.bind ? "yes" : "no"; }
    function kindOfBindOfBigInt(c) { var g = functionOrBigInt(c); return typeof g.bind; }
    function isBindOfBigInt(c) { var g = functionOrBigInt(c); return g.bind === Function.prototype.bind; }
    function lacksBindOfBigInt(c) { var g = functionOrBigInt(c); return g.bind === undefined; }
    function functionOrPlainObject(c) { return c ? plainObject : Math.floor; }
    function hasCallOfPlainObject(c) { var g = functionOrPlainObject(c); return g.call ? "yes" : "no"; }
    function kindOfCallOfPlainObject(c) { var g = functionOrPlainObject(c); return typeof g.call; }
    function isCallOfPlainObject(c) { var g = functionOrPlainObject(c); return g.call === Function.prototype.call; }
    function lacksCallOfPlainObject(c) { var g = functionOrPlainObject(c); return g.call === undefined; }
    function hasApplyOfPlainObject(c) { var g = functionOrPlainObject(c); return g.apply ? "yes" : "no"; }
    function kindOfApplyOfPlainObject(c) { var g = functionOrPlainObject(c); return typeof g.apply; }
    function isApplyOfPlainObject(c) { var g = functionOrPlainObject(c); return g.apply === Function.prototype.apply; }
    function lacksApplyOfPlainObject(c) { var g = functionOrPlainObject(c); return g.apply === undefined; }
    function hasBindOfPlainObject(c) { var g = functionOrPlainObject(c); return g.bind ? "yes" : "no"; }
    function kindOfBindOfPlainObject(c) { var g = functionOrPlainObject(c); return typeof g.bind; }
    function isBindOfPlainObject(c) { var g = functionOrPlainObject(c); return g.bind === Function.prototype.bind; }
    function lacksBindOfPlainObject(c) { var g = functionOrPlainObject(c); return g.bind === undefined; }
    function functionOrObjectWithItsOwn(c) { return c ? objectWithItsOwn : Math.floor; }
    function hasCallOfObjectWithItsOwn(c) { var g = functionOrObjectWithItsOwn(c); return g.call ? "yes" : "no"; }
    function kindOfCallOfObjectWithItsOwn(c) { var g = functionOrObjectWithItsOwn(c); return typeof g.call; }
    function isCallOfObjectWithItsOwn(c) { var g = functionOrObjectWithItsOwn(c); return g.call === Function.prototype.call; }
    function lacksCallOfObjectWithItsOwn(c) { var g = functionOrObjectWithItsOwn(c); return g.call === undefined; }
    function hasApplyOfObjectWithItsOwn(c) { var g = functionOrObjectWithItsOwn(c); return g.apply ? "yes" : "no"; }
    function kindOfApplyOfObjectWithItsOwn(c) { var g = functionOrObjectWithItsOwn(c); return typeof g.apply; }
    function isApplyOfObjectWithItsOwn(c) { var g = functionOrObjectWithItsOwn(c); return g.apply === Function.prototype.apply; }
    function lacksApplyOfObjectWithItsOwn(c) { var g = functionOrObjectWithItsOwn(c); return g.apply === undefined; }
    function hasBindOfObjectWithItsOwn(c) { var g = functionOrObjectWithItsOwn(c); return g.bind ? "yes" : "no"; }
    function kindOfBindOfObjectWithItsOwn(c) { var g = functionOrObjectWithItsOwn(c); return typeof g.bind; }
    function isBindOfObjectWithItsOwn(c) { var g = functionOrObjectWithItsOwn(c); return g.bind === Function.prototype.bind; }
    function lacksBindOfObjectWithItsOwn(c) { var g = functionOrObjectWithItsOwn(c); return g.bind === undefined; }
    function functionOrProgramFunction(c) { return c ? programFunction : Math.floor; }
    function hasCallOfProgramFunction(c) { var g = functionOrProgramFunction(c); return g.call ? "yes" : "no"; }
    function kindOfCallOfProgramFunction(c) { var g = functionOrProgramFunction(c); return typeof g.call; }
    function isCallOfProgramFunction(c) { var g = functionOrProgramFunction(c); return g.call === Function.prototype.call; }
    function lacksCallOfProgramFunction(c) { var g = functionOrProgramFunction(c); return g.call === undefined; }
    function hasApplyOfProgramFunction(c) { var g = functionOrProgramFunction(c); return g.apply ? "yes" : "no"; }
    function kindOfApplyOfProgramFunction(c) { var g = functionOrProgramFunction(c); return typeof g.apply; }
    function isApplyOfProgramFunction(c) { var g = functionOrProgramFunction(c); return g.apply === Function.prototype.apply; }
    function lacksApplyOfProgramFunction(c) { var g = functionOrProgramFunction(c); return g.apply === undefined; }
    function hasBindOfProgramFunction(c) { var g = functionOrProgramFunction(c); return g.bind ? "yes" : "no"; }
    function kindOfBindOfProgramFunction(c) { var g = functionOrProgramFunction(c); return typeof g.bind; }
    function isBindOfProgramFunction(c) { var g = functionOrProgramFunction(c); return g.bind === Function.prototype.bind; }
    function lacksBindOfProgramFunction(c) { var g = functionOrProgramFunction(c); return g.bind === undefined; }
    function functionOrProgramFunctionWithItsOwn(c) { return c ? programFunctionWithItsOwn : Math.floor; }
    function hasCallOfProgramFunctionWithItsOwn(c) { var g = functionOrProgramFunctionWithItsOwn(c); return g.call ? "yes" : "no"; }
    function kindOfCallOfProgramFunctionWithItsOwn(c) { var g = functionOrProgramFunctionWithItsOwn(c); return typeof g.call; }
    function isCallOfProgramFunctionWithItsOwn(c) { var g = functionOrProgramFunctionWithItsOwn(c); return g.call === Function.prototype.call; }
    function lacksCallOfProgramFunctionWithItsOwn(c) { var g = functionOrProgramFunctionWithItsOwn(c); return g.call === undefined; }
    function hasApplyOfProgramFunctionWithItsOwn(c) { var g = functionOrProgramFunctionWithItsOwn(c); return g.apply ? "yes" : "no"; }
    function kindOfApplyOfProgramFunctionWithItsOwn(c) { var g = functionOrProgramFunctionWithItsOwn(c); return typeof g.apply; }
    function isApplyOfProgramFunctionWithItsOwn(c) { var g = functionOrProgramFunctionWithItsOwn(c); return g.apply === Function.prototype.apply; }
    function lacksApplyOfProgramFunctionWithItsOwn(c) { var g = functionOrProgramFunctionWithItsOwn(c); return g.apply === undefined; }
    function hasBindOfProgramFunctionWithItsOwn(c) { var g = functionOrProgramFunctionWithItsOwn(c); return g.bind ? "yes" : "no"; }
    function kindOfBindOfProgramFunctionWithItsOwn(c) { var g = functionOrProgramFunctionWithItsOwn(c); return typeof g.bind; }
    function isBindOfProgramFunctionWithItsOwn(c) { var g = functionOrProgramFunctionWithItsOwn(c); return g.bind === Function.prototype.bind; }
    function lacksBindOfProgramFunctionWithItsOwn(c) { var g = functionOrProgramFunctionWithItsOwn(c); return g.bind === undefined; }
    function functionOrNull(c) { return c ? null : Math.floor; }
    function hasCallOfNull(c) { var g = functionOrNull(c); return g.call ? "yes" : "no"; }
    function kindOfCallOfNull(c) { var g = functionOrNull(c); return typeof g.call; }
    function isCallOfNull(c) { var g = functionOrNull(c); return g.call === Function.prototype.call; }
    function lacksCallOfNull(c) { var g = functionOrNull(c); return g.call === undefined; }
    function hasApplyOfNull(c) { var g = functionOrNull(c); return g.apply ? "yes" : "no"; }
    function kindOfApplyOfNull(c) { var g = functionOrNull(c); return typeof g.apply; }
    function isApplyOfNull(c) { var g = functionOrNull(c); return g.apply === Function.prototype.apply; }
    function lacksApplyOfNull(c) { var g = functionOrNull(c); return g.apply === undefined; }
    function hasBindOfNull(c) { var g = functionOrNull(c); return g.bind ? "yes" : "no"; }
    function kindOfBindOfNull(c) { var g = functionOrNull(c); return typeof g.bind; }
    function isBindOfNull(c) { var g = functionOrNull(c); return g.bind === Function.prototype.bind; }
    function lacksBindOfNull(c) { var g = functionOrNull(c); return g.bind === undefined; }
    function functionOrUndefined(c) { return c ? undefined : Math.floor; }
    function hasCallOfUndefined(c) { var g = functionOrUndefined(c); return g.call ? "yes" : "no"; }
    function kindOfCallOfUndefined(c) { var g = functionOrUndefined(c); return typeof g.call; }
    function isCallOfUndefined(c) { var g = functionOrUndefined(c); return g.call === Function.prototype.call; }
    function lacksCallOfUndefined(c) { var g = functionOrUndefined(c); return g.call === undefined; }
    function hasApplyOfUndefined(c) { var g = functionOrUndefined(c); return g.apply ? "yes" : "no"; }
    function kindOfApplyOfUndefined(c) { var g = functionOrUndefined(c); return typeof g.apply; }
    function isApplyOfUndefined(c) { var g = functionOrUndefined(c); return g.apply === Function.prototype.apply; }
    function lacksApplyOfUndefined(c) { var g = functionOrUndefined(c); return g.apply === undefined; }
    function hasBindOfUndefined(c) { var g = functionOrUndefined(c); return g.bind ? "yes" : "no"; }
    function kindOfBindOfUndefined(c) { var g = functionOrUndefined(c); return typeof g.bind; }
    function isBindOfUndefined(c) { var g = functionOrUndefined(c); return g.bind === Function.prototype.bind; }
    function lacksBindOfUndefined(c) { var g = functionOrUndefined(c); return g.bind === undefined; }
    function onlyTheFunction() { return Math.floor; }
    function hasCallOfOnlyTheFunction() { var g = onlyTheFunction(); return g.call ? "yes" : "no"; }
    function hasApplyOfOnlyTheFunction() { var g = onlyTheFunction(); return g.apply ? "yes" : "no"; }
    function hasBindOfOnlyTheFunction() { var g = onlyTheFunction(); return g.bind ? "yes" : "no"; }

    function valueToFixedOfNumber(c) { return 1.5; }
    function whichToFixedOfNumber(c) { var x = valueToFixedOfNumber(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfNumber(c) { var x = valueToFixedOfNumber(c); return x.toFixed ? "yes" : "no"; }
    function valueToFixedOfNumberOrString(c) { return c ? "s" : 1.5; }
    function whichToFixedOfNumberOrString(c) { var x = valueToFixedOfNumberOrString(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfNumberOrString(c) { var x = valueToFixedOfNumberOrString(c); return x.toFixed ? "yes" : "no"; }
    function valueToFixedOfNumberOrBoolean(c) { return c ? true : 1.5; }
    function whichToFixedOfNumberOrBoolean(c) { var x = valueToFixedOfNumberOrBoolean(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfNumberOrBoolean(c) { var x = valueToFixedOfNumberOrBoolean(c); return x.toFixed ? "yes" : "no"; }
    function valueToFixedOfNumberOrSymbol(c) { return c ? symbol : 1.5; }
    function whichToFixedOfNumberOrSymbol(c) { var x = valueToFixedOfNumberOrSymbol(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfNumberOrSymbol(c) { var x = valueToFixedOfNumberOrSymbol(c); return x.toFixed ? "yes" : "no"; }
    function valueToFixedOfNumberOrBigInt(c) { return c ? 5n : 1.5; }
    function whichToFixedOfNumberOrBigInt(c) { var x = valueToFixedOfNumberOrBigInt(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfNumberOrBigInt(c) { var x = valueToFixedOfNumberOrBigInt(c); return x.toFixed ? "yes" : "no"; }
    function valueToFixedOfNumberOrPlainObject(c) { return c ? plainObject : 1.5; }
    function whichToFixedOfNumberOrPlainObject(c) { var x = valueToFixedOfNumberOrPlainObject(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfNumberOrPlainObject(c) { var x = valueToFixedOfNumberOrPlainObject(c); return x.toFixed ? "yes" : "no"; }
    function valueToFixedOfNumberOrObjectWithItsOwn(c) { return c ? objectWithItsOwn : 1.5; }
    function whichToFixedOfNumberOrObjectWithItsOwn(c) { var x = valueToFixedOfNumberOrObjectWithItsOwn(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfNumberOrObjectWithItsOwn(c) { var x = valueToFixedOfNumberOrObjectWithItsOwn(c); return x.toFixed ? "yes" : "no"; }
    function valueToFixedOfNumberOrNull(c) { return c ? null : 1.5; }
    function whichToFixedOfNumberOrNull(c) { var x = valueToFixedOfNumberOrNull(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfNumberOrNull(c) { var x = valueToFixedOfNumberOrNull(c); return x.toFixed ? "yes" : "no"; }
    function valueToFixedOfNumberOrUndefined(c) { return c ? undefined : 1.5; }
    function whichToFixedOfNumberOrUndefined(c) { var x = valueToFixedOfNumberOrUndefined(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfNumberOrUndefined(c) { var x = valueToFixedOfNumberOrUndefined(c); return x.toFixed ? "yes" : "no"; }
    function valueToStringOfNumber(c) { return 1.5; }
    function whichToStringOfNumber(c) { var x = valueToStringOfNumber(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfNumber(c) { var x = valueToStringOfNumber(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfNumberOrString(c) { return c ? "s" : 1.5; }
    function whichToStringOfNumberOrString(c) { var x = valueToStringOfNumberOrString(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfNumberOrString(c) { var x = valueToStringOfNumberOrString(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfNumberOrBoolean(c) { return c ? true : 1.5; }
    function whichToStringOfNumberOrBoolean(c) { var x = valueToStringOfNumberOrBoolean(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfNumberOrBoolean(c) { var x = valueToStringOfNumberOrBoolean(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfNumberOrSymbol(c) { return c ? symbol : 1.5; }
    function whichToStringOfNumberOrSymbol(c) { var x = valueToStringOfNumberOrSymbol(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfNumberOrSymbol(c) { var x = valueToStringOfNumberOrSymbol(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfNumberOrBigInt(c) { return c ? 5n : 1.5; }
    function whichToStringOfNumberOrBigInt(c) { var x = valueToStringOfNumberOrBigInt(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfNumberOrBigInt(c) { var x = valueToStringOfNumberOrBigInt(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfNumberOrPlainObject(c) { return c ? plainObject : 1.5; }
    function whichToStringOfNumberOrPlainObject(c) { var x = valueToStringOfNumberOrPlainObject(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfNumberOrPlainObject(c) { var x = valueToStringOfNumberOrPlainObject(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfNumberOrObjectWithItsOwn(c) { return c ? objectWithItsOwn : 1.5; }
    function whichToStringOfNumberOrObjectWithItsOwn(c) { var x = valueToStringOfNumberOrObjectWithItsOwn(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfNumberOrObjectWithItsOwn(c) { var x = valueToStringOfNumberOrObjectWithItsOwn(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfNumberOrNull(c) { return c ? null : 1.5; }
    function whichToStringOfNumberOrNull(c) { var x = valueToStringOfNumberOrNull(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfNumberOrNull(c) { var x = valueToStringOfNumberOrNull(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfNumberOrUndefined(c) { return c ? undefined : 1.5; }
    function whichToStringOfNumberOrUndefined(c) { var x = valueToStringOfNumberOrUndefined(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfNumberOrUndefined(c) { var x = valueToStringOfNumberOrUndefined(c); return x.toString ? "yes" : "no"; }
    function valueToFixedOfInt32(c) { return 7; }
    function whichToFixedOfInt32(c) { var x = valueToFixedOfInt32(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfInt32(c) { var x = valueToFixedOfInt32(c); return x.toFixed ? "yes" : "no"; }
    function valueToFixedOfInt32OrString(c) { return c ? "s" : 7; }
    function whichToFixedOfInt32OrString(c) { var x = valueToFixedOfInt32OrString(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfInt32OrString(c) { var x = valueToFixedOfInt32OrString(c); return x.toFixed ? "yes" : "no"; }
    function valueToFixedOfInt32OrBoolean(c) { return c ? true : 7; }
    function whichToFixedOfInt32OrBoolean(c) { var x = valueToFixedOfInt32OrBoolean(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfInt32OrBoolean(c) { var x = valueToFixedOfInt32OrBoolean(c); return x.toFixed ? "yes" : "no"; }
    function valueToFixedOfInt32OrSymbol(c) { return c ? symbol : 7; }
    function whichToFixedOfInt32OrSymbol(c) { var x = valueToFixedOfInt32OrSymbol(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfInt32OrSymbol(c) { var x = valueToFixedOfInt32OrSymbol(c); return x.toFixed ? "yes" : "no"; }
    function valueToFixedOfInt32OrBigInt(c) { return c ? 5n : 7; }
    function whichToFixedOfInt32OrBigInt(c) { var x = valueToFixedOfInt32OrBigInt(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfInt32OrBigInt(c) { var x = valueToFixedOfInt32OrBigInt(c); return x.toFixed ? "yes" : "no"; }
    function valueToFixedOfInt32OrPlainObject(c) { return c ? plainObject : 7; }
    function whichToFixedOfInt32OrPlainObject(c) { var x = valueToFixedOfInt32OrPlainObject(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfInt32OrPlainObject(c) { var x = valueToFixedOfInt32OrPlainObject(c); return x.toFixed ? "yes" : "no"; }
    function valueToFixedOfInt32OrObjectWithItsOwn(c) { return c ? objectWithItsOwn : 7; }
    function whichToFixedOfInt32OrObjectWithItsOwn(c) { var x = valueToFixedOfInt32OrObjectWithItsOwn(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfInt32OrObjectWithItsOwn(c) { var x = valueToFixedOfInt32OrObjectWithItsOwn(c); return x.toFixed ? "yes" : "no"; }
    function valueToFixedOfInt32OrNull(c) { return c ? null : 7; }
    function whichToFixedOfInt32OrNull(c) { var x = valueToFixedOfInt32OrNull(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfInt32OrNull(c) { var x = valueToFixedOfInt32OrNull(c); return x.toFixed ? "yes" : "no"; }
    function valueToFixedOfInt32OrUndefined(c) { return c ? undefined : 7; }
    function whichToFixedOfInt32OrUndefined(c) { var x = valueToFixedOfInt32OrUndefined(c); return x.toFixed === undefined ? "undefined" : x.toFixed === 0 ? "its own" : x.toFixed === Number.prototype.toFixed ? "of Number" : "another"; }
    function hasToFixedOfInt32OrUndefined(c) { var x = valueToFixedOfInt32OrUndefined(c); return x.toFixed ? "yes" : "no"; }
    function valueTrimOfString(c) { return "s"; }
    function whichTrimOfString(c) { var x = valueTrimOfString(c); return x.trim === undefined ? "undefined" : x.trim === 0 ? "its own" : x.trim === String.prototype.trim ? "of String" : "another"; }
    function hasTrimOfString(c) { var x = valueTrimOfString(c); return x.trim ? "yes" : "no"; }
    function valueTrimOfStringOrNumber(c) { return c ? 1.5 : "s"; }
    function whichTrimOfStringOrNumber(c) { var x = valueTrimOfStringOrNumber(c); return x.trim === undefined ? "undefined" : x.trim === 0 ? "its own" : x.trim === String.prototype.trim ? "of String" : "another"; }
    function hasTrimOfStringOrNumber(c) { var x = valueTrimOfStringOrNumber(c); return x.trim ? "yes" : "no"; }
    function valueTrimOfStringOrInt32(c) { return c ? 7 : "s"; }
    function whichTrimOfStringOrInt32(c) { var x = valueTrimOfStringOrInt32(c); return x.trim === undefined ? "undefined" : x.trim === 0 ? "its own" : x.trim === String.prototype.trim ? "of String" : "another"; }
    function hasTrimOfStringOrInt32(c) { var x = valueTrimOfStringOrInt32(c); return x.trim ? "yes" : "no"; }
    function valueTrimOfStringOrBoolean(c) { return c ? true : "s"; }
    function whichTrimOfStringOrBoolean(c) { var x = valueTrimOfStringOrBoolean(c); return x.trim === undefined ? "undefined" : x.trim === 0 ? "its own" : x.trim === String.prototype.trim ? "of String" : "another"; }
    function hasTrimOfStringOrBoolean(c) { var x = valueTrimOfStringOrBoolean(c); return x.trim ? "yes" : "no"; }
    function valueTrimOfStringOrSymbol(c) { return c ? symbol : "s"; }
    function whichTrimOfStringOrSymbol(c) { var x = valueTrimOfStringOrSymbol(c); return x.trim === undefined ? "undefined" : x.trim === 0 ? "its own" : x.trim === String.prototype.trim ? "of String" : "another"; }
    function hasTrimOfStringOrSymbol(c) { var x = valueTrimOfStringOrSymbol(c); return x.trim ? "yes" : "no"; }
    function valueTrimOfStringOrBigInt(c) { return c ? 5n : "s"; }
    function whichTrimOfStringOrBigInt(c) { var x = valueTrimOfStringOrBigInt(c); return x.trim === undefined ? "undefined" : x.trim === 0 ? "its own" : x.trim === String.prototype.trim ? "of String" : "another"; }
    function hasTrimOfStringOrBigInt(c) { var x = valueTrimOfStringOrBigInt(c); return x.trim ? "yes" : "no"; }
    function valueTrimOfStringOrPlainObject(c) { return c ? plainObject : "s"; }
    function whichTrimOfStringOrPlainObject(c) { var x = valueTrimOfStringOrPlainObject(c); return x.trim === undefined ? "undefined" : x.trim === 0 ? "its own" : x.trim === String.prototype.trim ? "of String" : "another"; }
    function hasTrimOfStringOrPlainObject(c) { var x = valueTrimOfStringOrPlainObject(c); return x.trim ? "yes" : "no"; }
    function valueTrimOfStringOrObjectWithItsOwn(c) { return c ? objectWithItsOwn : "s"; }
    function whichTrimOfStringOrObjectWithItsOwn(c) { var x = valueTrimOfStringOrObjectWithItsOwn(c); return x.trim === undefined ? "undefined" : x.trim === 0 ? "its own" : x.trim === String.prototype.trim ? "of String" : "another"; }
    function hasTrimOfStringOrObjectWithItsOwn(c) { var x = valueTrimOfStringOrObjectWithItsOwn(c); return x.trim ? "yes" : "no"; }
    function valueTrimOfStringOrNull(c) { return c ? null : "s"; }
    function whichTrimOfStringOrNull(c) { var x = valueTrimOfStringOrNull(c); return x.trim === undefined ? "undefined" : x.trim === 0 ? "its own" : x.trim === String.prototype.trim ? "of String" : "another"; }
    function hasTrimOfStringOrNull(c) { var x = valueTrimOfStringOrNull(c); return x.trim ? "yes" : "no"; }
    function valueTrimOfStringOrUndefined(c) { return c ? undefined : "s"; }
    function whichTrimOfStringOrUndefined(c) { var x = valueTrimOfStringOrUndefined(c); return x.trim === undefined ? "undefined" : x.trim === 0 ? "its own" : x.trim === String.prototype.trim ? "of String" : "another"; }
    function hasTrimOfStringOrUndefined(c) { var x = valueTrimOfStringOrUndefined(c); return x.trim ? "yes" : "no"; }
    function valueToStringOfString(c) { return "s"; }
    function whichToStringOfString(c) { var x = valueToStringOfString(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfString(c) { var x = valueToStringOfString(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfStringOrNumber(c) { return c ? 1.5 : "s"; }
    function whichToStringOfStringOrNumber(c) { var x = valueToStringOfStringOrNumber(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfStringOrNumber(c) { var x = valueToStringOfStringOrNumber(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfStringOrInt32(c) { return c ? 7 : "s"; }
    function whichToStringOfStringOrInt32(c) { var x = valueToStringOfStringOrInt32(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfStringOrInt32(c) { var x = valueToStringOfStringOrInt32(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfStringOrBoolean(c) { return c ? true : "s"; }
    function whichToStringOfStringOrBoolean(c) { var x = valueToStringOfStringOrBoolean(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfStringOrBoolean(c) { var x = valueToStringOfStringOrBoolean(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfStringOrSymbol(c) { return c ? symbol : "s"; }
    function whichToStringOfStringOrSymbol(c) { var x = valueToStringOfStringOrSymbol(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfStringOrSymbol(c) { var x = valueToStringOfStringOrSymbol(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfStringOrBigInt(c) { return c ? 5n : "s"; }
    function whichToStringOfStringOrBigInt(c) { var x = valueToStringOfStringOrBigInt(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfStringOrBigInt(c) { var x = valueToStringOfStringOrBigInt(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfStringOrPlainObject(c) { return c ? plainObject : "s"; }
    function whichToStringOfStringOrPlainObject(c) { var x = valueToStringOfStringOrPlainObject(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfStringOrPlainObject(c) { var x = valueToStringOfStringOrPlainObject(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfStringOrObjectWithItsOwn(c) { return c ? objectWithItsOwn : "s"; }
    function whichToStringOfStringOrObjectWithItsOwn(c) { var x = valueToStringOfStringOrObjectWithItsOwn(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfStringOrObjectWithItsOwn(c) { var x = valueToStringOfStringOrObjectWithItsOwn(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfStringOrNull(c) { return c ? null : "s"; }
    function whichToStringOfStringOrNull(c) { var x = valueToStringOfStringOrNull(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfStringOrNull(c) { var x = valueToStringOfStringOrNull(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfStringOrUndefined(c) { return c ? undefined : "s"; }
    function whichToStringOfStringOrUndefined(c) { var x = valueToStringOfStringOrUndefined(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfStringOrUndefined(c) { var x = valueToStringOfStringOrUndefined(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfBoolean(c) { return true; }
    function whichToStringOfBoolean(c) { var x = valueToStringOfBoolean(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfBoolean(c) { var x = valueToStringOfBoolean(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfBooleanOrNumber(c) { return c ? 1.5 : true; }
    function whichToStringOfBooleanOrNumber(c) { var x = valueToStringOfBooleanOrNumber(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfBooleanOrNumber(c) { var x = valueToStringOfBooleanOrNumber(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfBooleanOrInt32(c) { return c ? 7 : true; }
    function whichToStringOfBooleanOrInt32(c) { var x = valueToStringOfBooleanOrInt32(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfBooleanOrInt32(c) { var x = valueToStringOfBooleanOrInt32(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfBooleanOrString(c) { return c ? "s" : true; }
    function whichToStringOfBooleanOrString(c) { var x = valueToStringOfBooleanOrString(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfBooleanOrString(c) { var x = valueToStringOfBooleanOrString(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfBooleanOrSymbol(c) { return c ? symbol : true; }
    function whichToStringOfBooleanOrSymbol(c) { var x = valueToStringOfBooleanOrSymbol(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfBooleanOrSymbol(c) { var x = valueToStringOfBooleanOrSymbol(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfBooleanOrBigInt(c) { return c ? 5n : true; }
    function whichToStringOfBooleanOrBigInt(c) { var x = valueToStringOfBooleanOrBigInt(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfBooleanOrBigInt(c) { var x = valueToStringOfBooleanOrBigInt(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfBooleanOrPlainObject(c) { return c ? plainObject : true; }
    function whichToStringOfBooleanOrPlainObject(c) { var x = valueToStringOfBooleanOrPlainObject(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfBooleanOrPlainObject(c) { var x = valueToStringOfBooleanOrPlainObject(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfBooleanOrObjectWithItsOwn(c) { return c ? objectWithItsOwn : true; }
    function whichToStringOfBooleanOrObjectWithItsOwn(c) { var x = valueToStringOfBooleanOrObjectWithItsOwn(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfBooleanOrObjectWithItsOwn(c) { var x = valueToStringOfBooleanOrObjectWithItsOwn(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfBooleanOrNull(c) { return c ? null : true; }
    function whichToStringOfBooleanOrNull(c) { var x = valueToStringOfBooleanOrNull(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfBooleanOrNull(c) { var x = valueToStringOfBooleanOrNull(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfBooleanOrUndefined(c) { return c ? undefined : true; }
    function whichToStringOfBooleanOrUndefined(c) { var x = valueToStringOfBooleanOrUndefined(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfBooleanOrUndefined(c) { var x = valueToStringOfBooleanOrUndefined(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfSymbol(c) { return symbol; }
    function whichToStringOfSymbol(c) { var x = valueToStringOfSymbol(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfSymbol(c) { var x = valueToStringOfSymbol(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfSymbolOrNumber(c) { return c ? 1.5 : symbol; }
    function whichToStringOfSymbolOrNumber(c) { var x = valueToStringOfSymbolOrNumber(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfSymbolOrNumber(c) { var x = valueToStringOfSymbolOrNumber(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfSymbolOrInt32(c) { return c ? 7 : symbol; }
    function whichToStringOfSymbolOrInt32(c) { var x = valueToStringOfSymbolOrInt32(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfSymbolOrInt32(c) { var x = valueToStringOfSymbolOrInt32(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfSymbolOrString(c) { return c ? "s" : symbol; }
    function whichToStringOfSymbolOrString(c) { var x = valueToStringOfSymbolOrString(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfSymbolOrString(c) { var x = valueToStringOfSymbolOrString(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfSymbolOrBoolean(c) { return c ? true : symbol; }
    function whichToStringOfSymbolOrBoolean(c) { var x = valueToStringOfSymbolOrBoolean(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfSymbolOrBoolean(c) { var x = valueToStringOfSymbolOrBoolean(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfSymbolOrBigInt(c) { return c ? 5n : symbol; }
    function whichToStringOfSymbolOrBigInt(c) { var x = valueToStringOfSymbolOrBigInt(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfSymbolOrBigInt(c) { var x = valueToStringOfSymbolOrBigInt(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfSymbolOrPlainObject(c) { return c ? plainObject : symbol; }
    function whichToStringOfSymbolOrPlainObject(c) { var x = valueToStringOfSymbolOrPlainObject(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfSymbolOrPlainObject(c) { var x = valueToStringOfSymbolOrPlainObject(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfSymbolOrObjectWithItsOwn(c) { return c ? objectWithItsOwn : symbol; }
    function whichToStringOfSymbolOrObjectWithItsOwn(c) { var x = valueToStringOfSymbolOrObjectWithItsOwn(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfSymbolOrObjectWithItsOwn(c) { var x = valueToStringOfSymbolOrObjectWithItsOwn(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfSymbolOrNull(c) { return c ? null : symbol; }
    function whichToStringOfSymbolOrNull(c) { var x = valueToStringOfSymbolOrNull(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfSymbolOrNull(c) { var x = valueToStringOfSymbolOrNull(c); return x.toString ? "yes" : "no"; }
    function valueToStringOfSymbolOrUndefined(c) { return c ? undefined : symbol; }
    function whichToStringOfSymbolOrUndefined(c) { var x = valueToStringOfSymbolOrUndefined(c); return x.toString === undefined ? "undefined" : x.toString === 0 ? "its own" : x.toString === Number.prototype.toString ? "of Number" : x.toString === String.prototype.toString ? "of String" : x.toString === Boolean.prototype.toString ? "of Boolean" : x.toString === Symbol.prototype.toString ? "of Symbol" : x.toString === BigInt.prototype.toString ? "of BigInt" : x.toString === Object.prototype.toString ? "of Object" : "another"; }
    function hasToStringOfSymbolOrUndefined(c) { var x = valueToStringOfSymbolOrUndefined(c); return x.toString ? "yes" : "no"; }
    function valueValueOfOfNumber(c) { return 1.5; }
    function whichValueOfOfNumber(c) { var x = valueValueOfOfNumber(c); return x.valueOf === undefined ? "undefined" : x.valueOf === 0 ? "its own" : x.valueOf === Number.prototype.valueOf ? "of Number" : x.valueOf === String.prototype.valueOf ? "of String" : x.valueOf === Boolean.prototype.valueOf ? "of Boolean" : x.valueOf === Symbol.prototype.valueOf ? "of Symbol" : x.valueOf === BigInt.prototype.valueOf ? "of BigInt" : x.valueOf === Object.prototype.valueOf ? "of Object" : "another"; }
    function hasValueOfOfNumber(c) { var x = valueValueOfOfNumber(c); return x.valueOf ? "yes" : "no"; }
    function valueValueOfOfNumberOrString(c) { return c ? "s" : 1.5; }
    function whichValueOfOfNumberOrString(c) { var x = valueValueOfOfNumberOrString(c); return x.valueOf === undefined ? "undefined" : x.valueOf === 0 ? "its own" : x.valueOf === Number.prototype.valueOf ? "of Number" : x.valueOf === String.prototype.valueOf ? "of String" : x.valueOf === Boolean.prototype.valueOf ? "of Boolean" : x.valueOf === Symbol.prototype.valueOf ? "of Symbol" : x.valueOf === BigInt.prototype.valueOf ? "of BigInt" : x.valueOf === Object.prototype.valueOf ? "of Object" : "another"; }
    function hasValueOfOfNumberOrString(c) { var x = valueValueOfOfNumberOrString(c); return x.valueOf ? "yes" : "no"; }
    function valueValueOfOfNumberOrBoolean(c) { return c ? true : 1.5; }
    function whichValueOfOfNumberOrBoolean(c) { var x = valueValueOfOfNumberOrBoolean(c); return x.valueOf === undefined ? "undefined" : x.valueOf === 0 ? "its own" : x.valueOf === Number.prototype.valueOf ? "of Number" : x.valueOf === String.prototype.valueOf ? "of String" : x.valueOf === Boolean.prototype.valueOf ? "of Boolean" : x.valueOf === Symbol.prototype.valueOf ? "of Symbol" : x.valueOf === BigInt.prototype.valueOf ? "of BigInt" : x.valueOf === Object.prototype.valueOf ? "of Object" : "another"; }
    function hasValueOfOfNumberOrBoolean(c) { var x = valueValueOfOfNumberOrBoolean(c); return x.valueOf ? "yes" : "no"; }
    function valueValueOfOfNumberOrSymbol(c) { return c ? symbol : 1.5; }
    function whichValueOfOfNumberOrSymbol(c) { var x = valueValueOfOfNumberOrSymbol(c); return x.valueOf === undefined ? "undefined" : x.valueOf === 0 ? "its own" : x.valueOf === Number.prototype.valueOf ? "of Number" : x.valueOf === String.prototype.valueOf ? "of String" : x.valueOf === Boolean.prototype.valueOf ? "of Boolean" : x.valueOf === Symbol.prototype.valueOf ? "of Symbol" : x.valueOf === BigInt.prototype.valueOf ? "of BigInt" : x.valueOf === Object.prototype.valueOf ? "of Object" : "another"; }
    function hasValueOfOfNumberOrSymbol(c) { var x = valueValueOfOfNumberOrSymbol(c); return x.valueOf ? "yes" : "no"; }
    function valueValueOfOfNumberOrBigInt(c) { return c ? 5n : 1.5; }
    function whichValueOfOfNumberOrBigInt(c) { var x = valueValueOfOfNumberOrBigInt(c); return x.valueOf === undefined ? "undefined" : x.valueOf === 0 ? "its own" : x.valueOf === Number.prototype.valueOf ? "of Number" : x.valueOf === String.prototype.valueOf ? "of String" : x.valueOf === Boolean.prototype.valueOf ? "of Boolean" : x.valueOf === Symbol.prototype.valueOf ? "of Symbol" : x.valueOf === BigInt.prototype.valueOf ? "of BigInt" : x.valueOf === Object.prototype.valueOf ? "of Object" : "another"; }
    function hasValueOfOfNumberOrBigInt(c) { var x = valueValueOfOfNumberOrBigInt(c); return x.valueOf ? "yes" : "no"; }
    function valueValueOfOfNumberOrPlainObject(c) { return c ? plainObject : 1.5; }
    function whichValueOfOfNumberOrPlainObject(c) { var x = valueValueOfOfNumberOrPlainObject(c); return x.valueOf === undefined ? "undefined" : x.valueOf === 0 ? "its own" : x.valueOf === Number.prototype.valueOf ? "of Number" : x.valueOf === String.prototype.valueOf ? "of String" : x.valueOf === Boolean.prototype.valueOf ? "of Boolean" : x.valueOf === Symbol.prototype.valueOf ? "of Symbol" : x.valueOf === BigInt.prototype.valueOf ? "of BigInt" : x.valueOf === Object.prototype.valueOf ? "of Object" : "another"; }
    function hasValueOfOfNumberOrPlainObject(c) { var x = valueValueOfOfNumberOrPlainObject(c); return x.valueOf ? "yes" : "no"; }
    function valueValueOfOfNumberOrObjectWithItsOwn(c) { return c ? objectWithItsOwn : 1.5; }
    function whichValueOfOfNumberOrObjectWithItsOwn(c) { var x = valueValueOfOfNumberOrObjectWithItsOwn(c); return x.valueOf === undefined ? "undefined" : x.valueOf === 0 ? "its own" : x.valueOf === Number.prototype.valueOf ? "of Number" : x.valueOf === String.prototype.valueOf ? "of String" : x.valueOf === Boolean.prototype.valueOf ? "of Boolean" : x.valueOf === Symbol.prototype.valueOf ? "of Symbol" : x.valueOf === BigInt.prototype.valueOf ? "of BigInt" : x.valueOf === Object.prototype.valueOf ? "of Object" : "another"; }
    function hasValueOfOfNumberOrObjectWithItsOwn(c) { var x = valueValueOfOfNumberOrObjectWithItsOwn(c); return x.valueOf ? "yes" : "no"; }
    function valueValueOfOfNumberOrNull(c) { return c ? null : 1.5; }
    function whichValueOfOfNumberOrNull(c) { var x = valueValueOfOfNumberOrNull(c); return x.valueOf === undefined ? "undefined" : x.valueOf === 0 ? "its own" : x.valueOf === Number.prototype.valueOf ? "of Number" : x.valueOf === String.prototype.valueOf ? "of String" : x.valueOf === Boolean.prototype.valueOf ? "of Boolean" : x.valueOf === Symbol.prototype.valueOf ? "of Symbol" : x.valueOf === BigInt.prototype.valueOf ? "of BigInt" : x.valueOf === Object.prototype.valueOf ? "of Object" : "another"; }
    function hasValueOfOfNumberOrNull(c) { var x = valueValueOfOfNumberOrNull(c); return x.valueOf ? "yes" : "no"; }
    function valueValueOfOfNumberOrUndefined(c) { return c ? undefined : 1.5; }
    function whichValueOfOfNumberOrUndefined(c) { var x = valueValueOfOfNumberOrUndefined(c); return x.valueOf === undefined ? "undefined" : x.valueOf === 0 ? "its own" : x.valueOf === Number.prototype.valueOf ? "of Number" : x.valueOf === String.prototype.valueOf ? "of String" : x.valueOf === Boolean.prototype.valueOf ? "of Boolean" : x.valueOf === Symbol.prototype.valueOf ? "of Symbol" : x.valueOf === BigInt.prototype.valueOf ? "of BigInt" : x.valueOf === Object.prototype.valueOf ? "of Object" : "another"; }
    function hasValueOfOfNumberOrUndefined(c) { var x = valueValueOfOfNumberOrUndefined(c); return x.valueOf ? "yes" : "no"; }

    for (let round = 0; round < 20; ++round) {
        check(outcomeOf(() => hasCallOfInt32(true)), "no", "hasCallOfInt32 of the other value");
        check(outcomeOf(() => hasCallOfInt32(false)), "yes", "hasCallOfInt32 of the built-in function");
        check(outcomeOf(() => kindOfCallOfInt32(true)), "undefined", "kindOfCallOfInt32 of the other value");
        check(outcomeOf(() => kindOfCallOfInt32(false)), "function", "kindOfCallOfInt32 of the built-in function");
        check(outcomeOf(() => isCallOfInt32(true)), false, "isCallOfInt32 of the other value");
        check(outcomeOf(() => isCallOfInt32(false)), true, "isCallOfInt32 of the built-in function");
        check(outcomeOf(() => lacksCallOfInt32(true)), true, "lacksCallOfInt32 of the other value");
        check(outcomeOf(() => lacksCallOfInt32(false)), false, "lacksCallOfInt32 of the built-in function");
        check(outcomeOf(() => hasApplyOfInt32(true)), "no", "hasApplyOfInt32 of the other value");
        check(outcomeOf(() => hasApplyOfInt32(false)), "yes", "hasApplyOfInt32 of the built-in function");
        check(outcomeOf(() => kindOfApplyOfInt32(true)), "undefined", "kindOfApplyOfInt32 of the other value");
        check(outcomeOf(() => kindOfApplyOfInt32(false)), "function", "kindOfApplyOfInt32 of the built-in function");
        check(outcomeOf(() => isApplyOfInt32(true)), false, "isApplyOfInt32 of the other value");
        check(outcomeOf(() => isApplyOfInt32(false)), true, "isApplyOfInt32 of the built-in function");
        check(outcomeOf(() => lacksApplyOfInt32(true)), true, "lacksApplyOfInt32 of the other value");
        check(outcomeOf(() => lacksApplyOfInt32(false)), false, "lacksApplyOfInt32 of the built-in function");
        check(outcomeOf(() => hasBindOfInt32(true)), "no", "hasBindOfInt32 of the other value");
        check(outcomeOf(() => hasBindOfInt32(false)), "yes", "hasBindOfInt32 of the built-in function");
        check(outcomeOf(() => kindOfBindOfInt32(true)), "undefined", "kindOfBindOfInt32 of the other value");
        check(outcomeOf(() => kindOfBindOfInt32(false)), "function", "kindOfBindOfInt32 of the built-in function");
        check(outcomeOf(() => isBindOfInt32(true)), false, "isBindOfInt32 of the other value");
        check(outcomeOf(() => isBindOfInt32(false)), true, "isBindOfInt32 of the built-in function");
        check(outcomeOf(() => lacksBindOfInt32(true)), true, "lacksBindOfInt32 of the other value");
        check(outcomeOf(() => lacksBindOfInt32(false)), false, "lacksBindOfInt32 of the built-in function");
        check(outcomeOf(() => hasCallOfDouble(true)), "no", "hasCallOfDouble of the other value");
        check(outcomeOf(() => hasCallOfDouble(false)), "yes", "hasCallOfDouble of the built-in function");
        check(outcomeOf(() => kindOfCallOfDouble(true)), "undefined", "kindOfCallOfDouble of the other value");
        check(outcomeOf(() => kindOfCallOfDouble(false)), "function", "kindOfCallOfDouble of the built-in function");
        check(outcomeOf(() => isCallOfDouble(true)), false, "isCallOfDouble of the other value");
        check(outcomeOf(() => isCallOfDouble(false)), true, "isCallOfDouble of the built-in function");
        check(outcomeOf(() => lacksCallOfDouble(true)), true, "lacksCallOfDouble of the other value");
        check(outcomeOf(() => lacksCallOfDouble(false)), false, "lacksCallOfDouble of the built-in function");
        check(outcomeOf(() => hasApplyOfDouble(true)), "no", "hasApplyOfDouble of the other value");
        check(outcomeOf(() => hasApplyOfDouble(false)), "yes", "hasApplyOfDouble of the built-in function");
        check(outcomeOf(() => kindOfApplyOfDouble(true)), "undefined", "kindOfApplyOfDouble of the other value");
        check(outcomeOf(() => kindOfApplyOfDouble(false)), "function", "kindOfApplyOfDouble of the built-in function");
        check(outcomeOf(() => isApplyOfDouble(true)), false, "isApplyOfDouble of the other value");
        check(outcomeOf(() => isApplyOfDouble(false)), true, "isApplyOfDouble of the built-in function");
        check(outcomeOf(() => lacksApplyOfDouble(true)), true, "lacksApplyOfDouble of the other value");
        check(outcomeOf(() => lacksApplyOfDouble(false)), false, "lacksApplyOfDouble of the built-in function");
        check(outcomeOf(() => hasBindOfDouble(true)), "no", "hasBindOfDouble of the other value");
        check(outcomeOf(() => hasBindOfDouble(false)), "yes", "hasBindOfDouble of the built-in function");
        check(outcomeOf(() => kindOfBindOfDouble(true)), "undefined", "kindOfBindOfDouble of the other value");
        check(outcomeOf(() => kindOfBindOfDouble(false)), "function", "kindOfBindOfDouble of the built-in function");
        check(outcomeOf(() => isBindOfDouble(true)), false, "isBindOfDouble of the other value");
        check(outcomeOf(() => isBindOfDouble(false)), true, "isBindOfDouble of the built-in function");
        check(outcomeOf(() => lacksBindOfDouble(true)), true, "lacksBindOfDouble of the other value");
        check(outcomeOf(() => lacksBindOfDouble(false)), false, "lacksBindOfDouble of the built-in function");
        check(outcomeOf(() => hasCallOfString(true)), "no", "hasCallOfString of the other value");
        check(outcomeOf(() => hasCallOfString(false)), "yes", "hasCallOfString of the built-in function");
        check(outcomeOf(() => kindOfCallOfString(true)), "undefined", "kindOfCallOfString of the other value");
        check(outcomeOf(() => kindOfCallOfString(false)), "function", "kindOfCallOfString of the built-in function");
        check(outcomeOf(() => isCallOfString(true)), false, "isCallOfString of the other value");
        check(outcomeOf(() => isCallOfString(false)), true, "isCallOfString of the built-in function");
        check(outcomeOf(() => lacksCallOfString(true)), true, "lacksCallOfString of the other value");
        check(outcomeOf(() => lacksCallOfString(false)), false, "lacksCallOfString of the built-in function");
        check(outcomeOf(() => hasApplyOfString(true)), "no", "hasApplyOfString of the other value");
        check(outcomeOf(() => hasApplyOfString(false)), "yes", "hasApplyOfString of the built-in function");
        check(outcomeOf(() => kindOfApplyOfString(true)), "undefined", "kindOfApplyOfString of the other value");
        check(outcomeOf(() => kindOfApplyOfString(false)), "function", "kindOfApplyOfString of the built-in function");
        check(outcomeOf(() => isApplyOfString(true)), false, "isApplyOfString of the other value");
        check(outcomeOf(() => isApplyOfString(false)), true, "isApplyOfString of the built-in function");
        check(outcomeOf(() => lacksApplyOfString(true)), true, "lacksApplyOfString of the other value");
        check(outcomeOf(() => lacksApplyOfString(false)), false, "lacksApplyOfString of the built-in function");
        check(outcomeOf(() => hasBindOfString(true)), "no", "hasBindOfString of the other value");
        check(outcomeOf(() => hasBindOfString(false)), "yes", "hasBindOfString of the built-in function");
        check(outcomeOf(() => kindOfBindOfString(true)), "undefined", "kindOfBindOfString of the other value");
        check(outcomeOf(() => kindOfBindOfString(false)), "function", "kindOfBindOfString of the built-in function");
        check(outcomeOf(() => isBindOfString(true)), false, "isBindOfString of the other value");
        check(outcomeOf(() => isBindOfString(false)), true, "isBindOfString of the built-in function");
        check(outcomeOf(() => lacksBindOfString(true)), true, "lacksBindOfString of the other value");
        check(outcomeOf(() => lacksBindOfString(false)), false, "lacksBindOfString of the built-in function");
        check(outcomeOf(() => hasCallOfBoolean(true)), "no", "hasCallOfBoolean of the other value");
        check(outcomeOf(() => hasCallOfBoolean(false)), "yes", "hasCallOfBoolean of the built-in function");
        check(outcomeOf(() => kindOfCallOfBoolean(true)), "undefined", "kindOfCallOfBoolean of the other value");
        check(outcomeOf(() => kindOfCallOfBoolean(false)), "function", "kindOfCallOfBoolean of the built-in function");
        check(outcomeOf(() => isCallOfBoolean(true)), false, "isCallOfBoolean of the other value");
        check(outcomeOf(() => isCallOfBoolean(false)), true, "isCallOfBoolean of the built-in function");
        check(outcomeOf(() => lacksCallOfBoolean(true)), true, "lacksCallOfBoolean of the other value");
        check(outcomeOf(() => lacksCallOfBoolean(false)), false, "lacksCallOfBoolean of the built-in function");
        check(outcomeOf(() => hasApplyOfBoolean(true)), "no", "hasApplyOfBoolean of the other value");
        check(outcomeOf(() => hasApplyOfBoolean(false)), "yes", "hasApplyOfBoolean of the built-in function");
        check(outcomeOf(() => kindOfApplyOfBoolean(true)), "undefined", "kindOfApplyOfBoolean of the other value");
        check(outcomeOf(() => kindOfApplyOfBoolean(false)), "function", "kindOfApplyOfBoolean of the built-in function");
        check(outcomeOf(() => isApplyOfBoolean(true)), false, "isApplyOfBoolean of the other value");
        check(outcomeOf(() => isApplyOfBoolean(false)), true, "isApplyOfBoolean of the built-in function");
        check(outcomeOf(() => lacksApplyOfBoolean(true)), true, "lacksApplyOfBoolean of the other value");
        check(outcomeOf(() => lacksApplyOfBoolean(false)), false, "lacksApplyOfBoolean of the built-in function");
        check(outcomeOf(() => hasBindOfBoolean(true)), "no", "hasBindOfBoolean of the other value");
        check(outcomeOf(() => hasBindOfBoolean(false)), "yes", "hasBindOfBoolean of the built-in function");
        check(outcomeOf(() => kindOfBindOfBoolean(true)), "undefined", "kindOfBindOfBoolean of the other value");
        check(outcomeOf(() => kindOfBindOfBoolean(false)), "function", "kindOfBindOfBoolean of the built-in function");
        check(outcomeOf(() => isBindOfBoolean(true)), false, "isBindOfBoolean of the other value");
        check(outcomeOf(() => isBindOfBoolean(false)), true, "isBindOfBoolean of the built-in function");
        check(outcomeOf(() => lacksBindOfBoolean(true)), true, "lacksBindOfBoolean of the other value");
        check(outcomeOf(() => lacksBindOfBoolean(false)), false, "lacksBindOfBoolean of the built-in function");
        check(outcomeOf(() => hasCallOfSymbol(true)), "no", "hasCallOfSymbol of the other value");
        check(outcomeOf(() => hasCallOfSymbol(false)), "yes", "hasCallOfSymbol of the built-in function");
        check(outcomeOf(() => kindOfCallOfSymbol(true)), "undefined", "kindOfCallOfSymbol of the other value");
        check(outcomeOf(() => kindOfCallOfSymbol(false)), "function", "kindOfCallOfSymbol of the built-in function");
        check(outcomeOf(() => isCallOfSymbol(true)), false, "isCallOfSymbol of the other value");
        check(outcomeOf(() => isCallOfSymbol(false)), true, "isCallOfSymbol of the built-in function");
        check(outcomeOf(() => lacksCallOfSymbol(true)), true, "lacksCallOfSymbol of the other value");
        check(outcomeOf(() => lacksCallOfSymbol(false)), false, "lacksCallOfSymbol of the built-in function");
        check(outcomeOf(() => hasApplyOfSymbol(true)), "no", "hasApplyOfSymbol of the other value");
        check(outcomeOf(() => hasApplyOfSymbol(false)), "yes", "hasApplyOfSymbol of the built-in function");
        check(outcomeOf(() => kindOfApplyOfSymbol(true)), "undefined", "kindOfApplyOfSymbol of the other value");
        check(outcomeOf(() => kindOfApplyOfSymbol(false)), "function", "kindOfApplyOfSymbol of the built-in function");
        check(outcomeOf(() => isApplyOfSymbol(true)), false, "isApplyOfSymbol of the other value");
        check(outcomeOf(() => isApplyOfSymbol(false)), true, "isApplyOfSymbol of the built-in function");
        check(outcomeOf(() => lacksApplyOfSymbol(true)), true, "lacksApplyOfSymbol of the other value");
        check(outcomeOf(() => lacksApplyOfSymbol(false)), false, "lacksApplyOfSymbol of the built-in function");
        check(outcomeOf(() => hasBindOfSymbol(true)), "no", "hasBindOfSymbol of the other value");
        check(outcomeOf(() => hasBindOfSymbol(false)), "yes", "hasBindOfSymbol of the built-in function");
        check(outcomeOf(() => kindOfBindOfSymbol(true)), "undefined", "kindOfBindOfSymbol of the other value");
        check(outcomeOf(() => kindOfBindOfSymbol(false)), "function", "kindOfBindOfSymbol of the built-in function");
        check(outcomeOf(() => isBindOfSymbol(true)), false, "isBindOfSymbol of the other value");
        check(outcomeOf(() => isBindOfSymbol(false)), true, "isBindOfSymbol of the built-in function");
        check(outcomeOf(() => lacksBindOfSymbol(true)), true, "lacksBindOfSymbol of the other value");
        check(outcomeOf(() => lacksBindOfSymbol(false)), false, "lacksBindOfSymbol of the built-in function");
        check(outcomeOf(() => hasCallOfBigInt(true)), "no", "hasCallOfBigInt of the other value");
        check(outcomeOf(() => hasCallOfBigInt(false)), "yes", "hasCallOfBigInt of the built-in function");
        check(outcomeOf(() => kindOfCallOfBigInt(true)), "undefined", "kindOfCallOfBigInt of the other value");
        check(outcomeOf(() => kindOfCallOfBigInt(false)), "function", "kindOfCallOfBigInt of the built-in function");
        check(outcomeOf(() => isCallOfBigInt(true)), false, "isCallOfBigInt of the other value");
        check(outcomeOf(() => isCallOfBigInt(false)), true, "isCallOfBigInt of the built-in function");
        check(outcomeOf(() => lacksCallOfBigInt(true)), true, "lacksCallOfBigInt of the other value");
        check(outcomeOf(() => lacksCallOfBigInt(false)), false, "lacksCallOfBigInt of the built-in function");
        check(outcomeOf(() => hasApplyOfBigInt(true)), "no", "hasApplyOfBigInt of the other value");
        check(outcomeOf(() => hasApplyOfBigInt(false)), "yes", "hasApplyOfBigInt of the built-in function");
        check(outcomeOf(() => kindOfApplyOfBigInt(true)), "undefined", "kindOfApplyOfBigInt of the other value");
        check(outcomeOf(() => kindOfApplyOfBigInt(false)), "function", "kindOfApplyOfBigInt of the built-in function");
        check(outcomeOf(() => isApplyOfBigInt(true)), false, "isApplyOfBigInt of the other value");
        check(outcomeOf(() => isApplyOfBigInt(false)), true, "isApplyOfBigInt of the built-in function");
        check(outcomeOf(() => lacksApplyOfBigInt(true)), true, "lacksApplyOfBigInt of the other value");
        check(outcomeOf(() => lacksApplyOfBigInt(false)), false, "lacksApplyOfBigInt of the built-in function");
        check(outcomeOf(() => hasBindOfBigInt(true)), "no", "hasBindOfBigInt of the other value");
        check(outcomeOf(() => hasBindOfBigInt(false)), "yes", "hasBindOfBigInt of the built-in function");
        check(outcomeOf(() => kindOfBindOfBigInt(true)), "undefined", "kindOfBindOfBigInt of the other value");
        check(outcomeOf(() => kindOfBindOfBigInt(false)), "function", "kindOfBindOfBigInt of the built-in function");
        check(outcomeOf(() => isBindOfBigInt(true)), false, "isBindOfBigInt of the other value");
        check(outcomeOf(() => isBindOfBigInt(false)), true, "isBindOfBigInt of the built-in function");
        check(outcomeOf(() => lacksBindOfBigInt(true)), true, "lacksBindOfBigInt of the other value");
        check(outcomeOf(() => lacksBindOfBigInt(false)), false, "lacksBindOfBigInt of the built-in function");
        check(outcomeOf(() => hasCallOfPlainObject(true)), "no", "hasCallOfPlainObject of the other value");
        check(outcomeOf(() => hasCallOfPlainObject(false)), "yes", "hasCallOfPlainObject of the built-in function");
        check(outcomeOf(() => kindOfCallOfPlainObject(true)), "undefined", "kindOfCallOfPlainObject of the other value");
        check(outcomeOf(() => kindOfCallOfPlainObject(false)), "function", "kindOfCallOfPlainObject of the built-in function");
        check(outcomeOf(() => isCallOfPlainObject(true)), false, "isCallOfPlainObject of the other value");
        check(outcomeOf(() => isCallOfPlainObject(false)), true, "isCallOfPlainObject of the built-in function");
        check(outcomeOf(() => lacksCallOfPlainObject(true)), true, "lacksCallOfPlainObject of the other value");
        check(outcomeOf(() => lacksCallOfPlainObject(false)), false, "lacksCallOfPlainObject of the built-in function");
        check(outcomeOf(() => hasApplyOfPlainObject(true)), "no", "hasApplyOfPlainObject of the other value");
        check(outcomeOf(() => hasApplyOfPlainObject(false)), "yes", "hasApplyOfPlainObject of the built-in function");
        check(outcomeOf(() => kindOfApplyOfPlainObject(true)), "undefined", "kindOfApplyOfPlainObject of the other value");
        check(outcomeOf(() => kindOfApplyOfPlainObject(false)), "function", "kindOfApplyOfPlainObject of the built-in function");
        check(outcomeOf(() => isApplyOfPlainObject(true)), false, "isApplyOfPlainObject of the other value");
        check(outcomeOf(() => isApplyOfPlainObject(false)), true, "isApplyOfPlainObject of the built-in function");
        check(outcomeOf(() => lacksApplyOfPlainObject(true)), true, "lacksApplyOfPlainObject of the other value");
        check(outcomeOf(() => lacksApplyOfPlainObject(false)), false, "lacksApplyOfPlainObject of the built-in function");
        check(outcomeOf(() => hasBindOfPlainObject(true)), "no", "hasBindOfPlainObject of the other value");
        check(outcomeOf(() => hasBindOfPlainObject(false)), "yes", "hasBindOfPlainObject of the built-in function");
        check(outcomeOf(() => kindOfBindOfPlainObject(true)), "undefined", "kindOfBindOfPlainObject of the other value");
        check(outcomeOf(() => kindOfBindOfPlainObject(false)), "function", "kindOfBindOfPlainObject of the built-in function");
        check(outcomeOf(() => isBindOfPlainObject(true)), false, "isBindOfPlainObject of the other value");
        check(outcomeOf(() => isBindOfPlainObject(false)), true, "isBindOfPlainObject of the built-in function");
        check(outcomeOf(() => lacksBindOfPlainObject(true)), true, "lacksBindOfPlainObject of the other value");
        check(outcomeOf(() => lacksBindOfPlainObject(false)), false, "lacksBindOfPlainObject of the built-in function");
        check(outcomeOf(() => hasCallOfObjectWithItsOwn(true)), "no", "hasCallOfObjectWithItsOwn of the other value");
        check(outcomeOf(() => hasCallOfObjectWithItsOwn(false)), "yes", "hasCallOfObjectWithItsOwn of the built-in function");
        check(outcomeOf(() => kindOfCallOfObjectWithItsOwn(true)), "number", "kindOfCallOfObjectWithItsOwn of the other value");
        check(outcomeOf(() => kindOfCallOfObjectWithItsOwn(false)), "function", "kindOfCallOfObjectWithItsOwn of the built-in function");
        check(outcomeOf(() => isCallOfObjectWithItsOwn(true)), false, "isCallOfObjectWithItsOwn of the other value");
        check(outcomeOf(() => isCallOfObjectWithItsOwn(false)), true, "isCallOfObjectWithItsOwn of the built-in function");
        check(outcomeOf(() => lacksCallOfObjectWithItsOwn(true)), false, "lacksCallOfObjectWithItsOwn of the other value");
        check(outcomeOf(() => lacksCallOfObjectWithItsOwn(false)), false, "lacksCallOfObjectWithItsOwn of the built-in function");
        check(outcomeOf(() => hasApplyOfObjectWithItsOwn(true)), "no", "hasApplyOfObjectWithItsOwn of the other value");
        check(outcomeOf(() => hasApplyOfObjectWithItsOwn(false)), "yes", "hasApplyOfObjectWithItsOwn of the built-in function");
        check(outcomeOf(() => kindOfApplyOfObjectWithItsOwn(true)), "number", "kindOfApplyOfObjectWithItsOwn of the other value");
        check(outcomeOf(() => kindOfApplyOfObjectWithItsOwn(false)), "function", "kindOfApplyOfObjectWithItsOwn of the built-in function");
        check(outcomeOf(() => isApplyOfObjectWithItsOwn(true)), false, "isApplyOfObjectWithItsOwn of the other value");
        check(outcomeOf(() => isApplyOfObjectWithItsOwn(false)), true, "isApplyOfObjectWithItsOwn of the built-in function");
        check(outcomeOf(() => lacksApplyOfObjectWithItsOwn(true)), false, "lacksApplyOfObjectWithItsOwn of the other value");
        check(outcomeOf(() => lacksApplyOfObjectWithItsOwn(false)), false, "lacksApplyOfObjectWithItsOwn of the built-in function");
        check(outcomeOf(() => hasBindOfObjectWithItsOwn(true)), "no", "hasBindOfObjectWithItsOwn of the other value");
        check(outcomeOf(() => hasBindOfObjectWithItsOwn(false)), "yes", "hasBindOfObjectWithItsOwn of the built-in function");
        check(outcomeOf(() => kindOfBindOfObjectWithItsOwn(true)), "number", "kindOfBindOfObjectWithItsOwn of the other value");
        check(outcomeOf(() => kindOfBindOfObjectWithItsOwn(false)), "function", "kindOfBindOfObjectWithItsOwn of the built-in function");
        check(outcomeOf(() => isBindOfObjectWithItsOwn(true)), false, "isBindOfObjectWithItsOwn of the other value");
        check(outcomeOf(() => isBindOfObjectWithItsOwn(false)), true, "isBindOfObjectWithItsOwn of the built-in function");
        check(outcomeOf(() => lacksBindOfObjectWithItsOwn(true)), false, "lacksBindOfObjectWithItsOwn of the other value");
        check(outcomeOf(() => lacksBindOfObjectWithItsOwn(false)), false, "lacksBindOfObjectWithItsOwn of the built-in function");
        check(outcomeOf(() => hasCallOfProgramFunction(true)), "yes", "hasCallOfProgramFunction of the other value");
        check(outcomeOf(() => hasCallOfProgramFunction(false)), "yes", "hasCallOfProgramFunction of the built-in function");
        check(outcomeOf(() => kindOfCallOfProgramFunction(true)), "function", "kindOfCallOfProgramFunction of the other value");
        check(outcomeOf(() => kindOfCallOfProgramFunction(false)), "function", "kindOfCallOfProgramFunction of the built-in function");
        check(outcomeOf(() => isCallOfProgramFunction(true)), true, "isCallOfProgramFunction of the other value");
        check(outcomeOf(() => isCallOfProgramFunction(false)), true, "isCallOfProgramFunction of the built-in function");
        check(outcomeOf(() => lacksCallOfProgramFunction(true)), false, "lacksCallOfProgramFunction of the other value");
        check(outcomeOf(() => lacksCallOfProgramFunction(false)), false, "lacksCallOfProgramFunction of the built-in function");
        check(outcomeOf(() => hasApplyOfProgramFunction(true)), "yes", "hasApplyOfProgramFunction of the other value");
        check(outcomeOf(() => hasApplyOfProgramFunction(false)), "yes", "hasApplyOfProgramFunction of the built-in function");
        check(outcomeOf(() => kindOfApplyOfProgramFunction(true)), "function", "kindOfApplyOfProgramFunction of the other value");
        check(outcomeOf(() => kindOfApplyOfProgramFunction(false)), "function", "kindOfApplyOfProgramFunction of the built-in function");
        check(outcomeOf(() => isApplyOfProgramFunction(true)), true, "isApplyOfProgramFunction of the other value");
        check(outcomeOf(() => isApplyOfProgramFunction(false)), true, "isApplyOfProgramFunction of the built-in function");
        check(outcomeOf(() => lacksApplyOfProgramFunction(true)), false, "lacksApplyOfProgramFunction of the other value");
        check(outcomeOf(() => lacksApplyOfProgramFunction(false)), false, "lacksApplyOfProgramFunction of the built-in function");
        check(outcomeOf(() => hasBindOfProgramFunction(true)), "yes", "hasBindOfProgramFunction of the other value");
        check(outcomeOf(() => hasBindOfProgramFunction(false)), "yes", "hasBindOfProgramFunction of the built-in function");
        check(outcomeOf(() => kindOfBindOfProgramFunction(true)), "function", "kindOfBindOfProgramFunction of the other value");
        check(outcomeOf(() => kindOfBindOfProgramFunction(false)), "function", "kindOfBindOfProgramFunction of the built-in function");
        check(outcomeOf(() => isBindOfProgramFunction(true)), true, "isBindOfProgramFunction of the other value");
        check(outcomeOf(() => isBindOfProgramFunction(false)), true, "isBindOfProgramFunction of the built-in function");
        check(outcomeOf(() => lacksBindOfProgramFunction(true)), false, "lacksBindOfProgramFunction of the other value");
        check(outcomeOf(() => lacksBindOfProgramFunction(false)), false, "lacksBindOfProgramFunction of the built-in function");
        check(outcomeOf(() => hasCallOfProgramFunctionWithItsOwn(true)), "no", "hasCallOfProgramFunctionWithItsOwn of the other value");
        check(outcomeOf(() => hasCallOfProgramFunctionWithItsOwn(false)), "yes", "hasCallOfProgramFunctionWithItsOwn of the built-in function");
        check(outcomeOf(() => kindOfCallOfProgramFunctionWithItsOwn(true)), "number", "kindOfCallOfProgramFunctionWithItsOwn of the other value");
        check(outcomeOf(() => kindOfCallOfProgramFunctionWithItsOwn(false)), "function", "kindOfCallOfProgramFunctionWithItsOwn of the built-in function");
        check(outcomeOf(() => isCallOfProgramFunctionWithItsOwn(true)), false, "isCallOfProgramFunctionWithItsOwn of the other value");
        check(outcomeOf(() => isCallOfProgramFunctionWithItsOwn(false)), true, "isCallOfProgramFunctionWithItsOwn of the built-in function");
        check(outcomeOf(() => lacksCallOfProgramFunctionWithItsOwn(true)), false, "lacksCallOfProgramFunctionWithItsOwn of the other value");
        check(outcomeOf(() => lacksCallOfProgramFunctionWithItsOwn(false)), false, "lacksCallOfProgramFunctionWithItsOwn of the built-in function");
        check(outcomeOf(() => hasApplyOfProgramFunctionWithItsOwn(true)), "no", "hasApplyOfProgramFunctionWithItsOwn of the other value");
        check(outcomeOf(() => hasApplyOfProgramFunctionWithItsOwn(false)), "yes", "hasApplyOfProgramFunctionWithItsOwn of the built-in function");
        check(outcomeOf(() => kindOfApplyOfProgramFunctionWithItsOwn(true)), "number", "kindOfApplyOfProgramFunctionWithItsOwn of the other value");
        check(outcomeOf(() => kindOfApplyOfProgramFunctionWithItsOwn(false)), "function", "kindOfApplyOfProgramFunctionWithItsOwn of the built-in function");
        check(outcomeOf(() => isApplyOfProgramFunctionWithItsOwn(true)), false, "isApplyOfProgramFunctionWithItsOwn of the other value");
        check(outcomeOf(() => isApplyOfProgramFunctionWithItsOwn(false)), true, "isApplyOfProgramFunctionWithItsOwn of the built-in function");
        check(outcomeOf(() => lacksApplyOfProgramFunctionWithItsOwn(true)), false, "lacksApplyOfProgramFunctionWithItsOwn of the other value");
        check(outcomeOf(() => lacksApplyOfProgramFunctionWithItsOwn(false)), false, "lacksApplyOfProgramFunctionWithItsOwn of the built-in function");
        check(outcomeOf(() => hasBindOfProgramFunctionWithItsOwn(true)), "no", "hasBindOfProgramFunctionWithItsOwn of the other value");
        check(outcomeOf(() => hasBindOfProgramFunctionWithItsOwn(false)), "yes", "hasBindOfProgramFunctionWithItsOwn of the built-in function");
        check(outcomeOf(() => kindOfBindOfProgramFunctionWithItsOwn(true)), "number", "kindOfBindOfProgramFunctionWithItsOwn of the other value");
        check(outcomeOf(() => kindOfBindOfProgramFunctionWithItsOwn(false)), "function", "kindOfBindOfProgramFunctionWithItsOwn of the built-in function");
        check(outcomeOf(() => isBindOfProgramFunctionWithItsOwn(true)), false, "isBindOfProgramFunctionWithItsOwn of the other value");
        check(outcomeOf(() => isBindOfProgramFunctionWithItsOwn(false)), true, "isBindOfProgramFunctionWithItsOwn of the built-in function");
        check(outcomeOf(() => lacksBindOfProgramFunctionWithItsOwn(true)), false, "lacksBindOfProgramFunctionWithItsOwn of the other value");
        check(outcomeOf(() => lacksBindOfProgramFunctionWithItsOwn(false)), false, "lacksBindOfProgramFunctionWithItsOwn of the built-in function");
        check(outcomeOf(() => hasCallOfNull(true)), "TypeError", "hasCallOfNull of the other value");
        check(outcomeOf(() => hasCallOfNull(false)), "yes", "hasCallOfNull of the built-in function");
        check(outcomeOf(() => kindOfCallOfNull(true)), "TypeError", "kindOfCallOfNull of the other value");
        check(outcomeOf(() => kindOfCallOfNull(false)), "function", "kindOfCallOfNull of the built-in function");
        check(outcomeOf(() => isCallOfNull(true)), "TypeError", "isCallOfNull of the other value");
        check(outcomeOf(() => isCallOfNull(false)), true, "isCallOfNull of the built-in function");
        check(outcomeOf(() => lacksCallOfNull(true)), "TypeError", "lacksCallOfNull of the other value");
        check(outcomeOf(() => lacksCallOfNull(false)), false, "lacksCallOfNull of the built-in function");
        check(outcomeOf(() => hasApplyOfNull(true)), "TypeError", "hasApplyOfNull of the other value");
        check(outcomeOf(() => hasApplyOfNull(false)), "yes", "hasApplyOfNull of the built-in function");
        check(outcomeOf(() => kindOfApplyOfNull(true)), "TypeError", "kindOfApplyOfNull of the other value");
        check(outcomeOf(() => kindOfApplyOfNull(false)), "function", "kindOfApplyOfNull of the built-in function");
        check(outcomeOf(() => isApplyOfNull(true)), "TypeError", "isApplyOfNull of the other value");
        check(outcomeOf(() => isApplyOfNull(false)), true, "isApplyOfNull of the built-in function");
        check(outcomeOf(() => lacksApplyOfNull(true)), "TypeError", "lacksApplyOfNull of the other value");
        check(outcomeOf(() => lacksApplyOfNull(false)), false, "lacksApplyOfNull of the built-in function");
        check(outcomeOf(() => hasBindOfNull(true)), "TypeError", "hasBindOfNull of the other value");
        check(outcomeOf(() => hasBindOfNull(false)), "yes", "hasBindOfNull of the built-in function");
        check(outcomeOf(() => kindOfBindOfNull(true)), "TypeError", "kindOfBindOfNull of the other value");
        check(outcomeOf(() => kindOfBindOfNull(false)), "function", "kindOfBindOfNull of the built-in function");
        check(outcomeOf(() => isBindOfNull(true)), "TypeError", "isBindOfNull of the other value");
        check(outcomeOf(() => isBindOfNull(false)), true, "isBindOfNull of the built-in function");
        check(outcomeOf(() => lacksBindOfNull(true)), "TypeError", "lacksBindOfNull of the other value");
        check(outcomeOf(() => lacksBindOfNull(false)), false, "lacksBindOfNull of the built-in function");
        check(outcomeOf(() => hasCallOfUndefined(true)), "TypeError", "hasCallOfUndefined of the other value");
        check(outcomeOf(() => hasCallOfUndefined(false)), "yes", "hasCallOfUndefined of the built-in function");
        check(outcomeOf(() => kindOfCallOfUndefined(true)), "TypeError", "kindOfCallOfUndefined of the other value");
        check(outcomeOf(() => kindOfCallOfUndefined(false)), "function", "kindOfCallOfUndefined of the built-in function");
        check(outcomeOf(() => isCallOfUndefined(true)), "TypeError", "isCallOfUndefined of the other value");
        check(outcomeOf(() => isCallOfUndefined(false)), true, "isCallOfUndefined of the built-in function");
        check(outcomeOf(() => lacksCallOfUndefined(true)), "TypeError", "lacksCallOfUndefined of the other value");
        check(outcomeOf(() => lacksCallOfUndefined(false)), false, "lacksCallOfUndefined of the built-in function");
        check(outcomeOf(() => hasApplyOfUndefined(true)), "TypeError", "hasApplyOfUndefined of the other value");
        check(outcomeOf(() => hasApplyOfUndefined(false)), "yes", "hasApplyOfUndefined of the built-in function");
        check(outcomeOf(() => kindOfApplyOfUndefined(true)), "TypeError", "kindOfApplyOfUndefined of the other value");
        check(outcomeOf(() => kindOfApplyOfUndefined(false)), "function", "kindOfApplyOfUndefined of the built-in function");
        check(outcomeOf(() => isApplyOfUndefined(true)), "TypeError", "isApplyOfUndefined of the other value");
        check(outcomeOf(() => isApplyOfUndefined(false)), true, "isApplyOfUndefined of the built-in function");
        check(outcomeOf(() => lacksApplyOfUndefined(true)), "TypeError", "lacksApplyOfUndefined of the other value");
        check(outcomeOf(() => lacksApplyOfUndefined(false)), false, "lacksApplyOfUndefined of the built-in function");
        check(outcomeOf(() => hasBindOfUndefined(true)), "TypeError", "hasBindOfUndefined of the other value");
        check(outcomeOf(() => hasBindOfUndefined(false)), "yes", "hasBindOfUndefined of the built-in function");
        check(outcomeOf(() => kindOfBindOfUndefined(true)), "TypeError", "kindOfBindOfUndefined of the other value");
        check(outcomeOf(() => kindOfBindOfUndefined(false)), "function", "kindOfBindOfUndefined of the built-in function");
        check(outcomeOf(() => isBindOfUndefined(true)), "TypeError", "isBindOfUndefined of the other value");
        check(outcomeOf(() => isBindOfUndefined(false)), true, "isBindOfUndefined of the built-in function");
        check(outcomeOf(() => lacksBindOfUndefined(true)), "TypeError", "lacksBindOfUndefined of the other value");
        check(outcomeOf(() => lacksBindOfUndefined(false)), false, "lacksBindOfUndefined of the built-in function");
        check(hasCallOfOnlyTheFunction(), "yes", "hasCallOfOnlyTheFunction");
        check(hasApplyOfOnlyTheFunction(), "yes", "hasApplyOfOnlyTheFunction");
        check(hasBindOfOnlyTheFunction(), "yes", "hasBindOfOnlyTheFunction");
        check(outcomeOf(() => whichToFixedOfNumber(false)), "of Number", "whichToFixedOfNumber of the first kind");
        check(outcomeOf(() => hasToFixedOfNumber(false)), "yes", "hasToFixedOfNumber of the first kind");
        check(outcomeOf(() => whichToFixedOfNumberOrString(false)), "of Number", "whichToFixedOfNumberOrString of the first kind");
        check(outcomeOf(() => hasToFixedOfNumberOrString(false)), "yes", "hasToFixedOfNumberOrString of the first kind");
        check(outcomeOf(() => whichToFixedOfNumberOrString(true)), "undefined", "whichToFixedOfNumberOrString of the second kind");
        check(outcomeOf(() => hasToFixedOfNumberOrString(true)), "no", "hasToFixedOfNumberOrString of the second kind");
        check(outcomeOf(() => whichToFixedOfNumberOrBoolean(false)), "of Number", "whichToFixedOfNumberOrBoolean of the first kind");
        check(outcomeOf(() => hasToFixedOfNumberOrBoolean(false)), "yes", "hasToFixedOfNumberOrBoolean of the first kind");
        check(outcomeOf(() => whichToFixedOfNumberOrBoolean(true)), "undefined", "whichToFixedOfNumberOrBoolean of the second kind");
        check(outcomeOf(() => hasToFixedOfNumberOrBoolean(true)), "no", "hasToFixedOfNumberOrBoolean of the second kind");
        check(outcomeOf(() => whichToFixedOfNumberOrSymbol(false)), "of Number", "whichToFixedOfNumberOrSymbol of the first kind");
        check(outcomeOf(() => hasToFixedOfNumberOrSymbol(false)), "yes", "hasToFixedOfNumberOrSymbol of the first kind");
        check(outcomeOf(() => whichToFixedOfNumberOrSymbol(true)), "undefined", "whichToFixedOfNumberOrSymbol of the second kind");
        check(outcomeOf(() => hasToFixedOfNumberOrSymbol(true)), "no", "hasToFixedOfNumberOrSymbol of the second kind");
        check(outcomeOf(() => whichToFixedOfNumberOrBigInt(false)), "of Number", "whichToFixedOfNumberOrBigInt of the first kind");
        check(outcomeOf(() => hasToFixedOfNumberOrBigInt(false)), "yes", "hasToFixedOfNumberOrBigInt of the first kind");
        check(outcomeOf(() => whichToFixedOfNumberOrBigInt(true)), "undefined", "whichToFixedOfNumberOrBigInt of the second kind");
        check(outcomeOf(() => hasToFixedOfNumberOrBigInt(true)), "no", "hasToFixedOfNumberOrBigInt of the second kind");
        check(outcomeOf(() => whichToFixedOfNumberOrPlainObject(false)), "of Number", "whichToFixedOfNumberOrPlainObject of the first kind");
        check(outcomeOf(() => hasToFixedOfNumberOrPlainObject(false)), "yes", "hasToFixedOfNumberOrPlainObject of the first kind");
        check(outcomeOf(() => whichToFixedOfNumberOrPlainObject(true)), "undefined", "whichToFixedOfNumberOrPlainObject of the second kind");
        check(outcomeOf(() => hasToFixedOfNumberOrPlainObject(true)), "no", "hasToFixedOfNumberOrPlainObject of the second kind");
        check(outcomeOf(() => whichToFixedOfNumberOrObjectWithItsOwn(false)), "of Number", "whichToFixedOfNumberOrObjectWithItsOwn of the first kind");
        check(outcomeOf(() => hasToFixedOfNumberOrObjectWithItsOwn(false)), "yes", "hasToFixedOfNumberOrObjectWithItsOwn of the first kind");
        check(outcomeOf(() => whichToFixedOfNumberOrObjectWithItsOwn(true)), "its own", "whichToFixedOfNumberOrObjectWithItsOwn of the second kind");
        check(outcomeOf(() => hasToFixedOfNumberOrObjectWithItsOwn(true)), "no", "hasToFixedOfNumberOrObjectWithItsOwn of the second kind");
        check(outcomeOf(() => whichToFixedOfNumberOrNull(false)), "of Number", "whichToFixedOfNumberOrNull of the first kind");
        check(outcomeOf(() => hasToFixedOfNumberOrNull(false)), "yes", "hasToFixedOfNumberOrNull of the first kind");
        check(outcomeOf(() => whichToFixedOfNumberOrNull(true)), "TypeError", "whichToFixedOfNumberOrNull of the second kind");
        check(outcomeOf(() => hasToFixedOfNumberOrNull(true)), "TypeError", "hasToFixedOfNumberOrNull of the second kind");
        check(outcomeOf(() => whichToFixedOfNumberOrUndefined(false)), "of Number", "whichToFixedOfNumberOrUndefined of the first kind");
        check(outcomeOf(() => hasToFixedOfNumberOrUndefined(false)), "yes", "hasToFixedOfNumberOrUndefined of the first kind");
        check(outcomeOf(() => whichToFixedOfNumberOrUndefined(true)), "TypeError", "whichToFixedOfNumberOrUndefined of the second kind");
        check(outcomeOf(() => hasToFixedOfNumberOrUndefined(true)), "TypeError", "hasToFixedOfNumberOrUndefined of the second kind");
        check(outcomeOf(() => whichToStringOfNumber(false)), "of Number", "whichToStringOfNumber of the first kind");
        check(outcomeOf(() => hasToStringOfNumber(false)), "yes", "hasToStringOfNumber of the first kind");
        check(outcomeOf(() => whichToStringOfNumberOrString(false)), "of Number", "whichToStringOfNumberOrString of the first kind");
        check(outcomeOf(() => hasToStringOfNumberOrString(false)), "yes", "hasToStringOfNumberOrString of the first kind");
        check(outcomeOf(() => whichToStringOfNumberOrString(true)), "of String", "whichToStringOfNumberOrString of the second kind");
        check(outcomeOf(() => hasToStringOfNumberOrString(true)), "yes", "hasToStringOfNumberOrString of the second kind");
        check(outcomeOf(() => whichToStringOfNumberOrBoolean(false)), "of Number", "whichToStringOfNumberOrBoolean of the first kind");
        check(outcomeOf(() => hasToStringOfNumberOrBoolean(false)), "yes", "hasToStringOfNumberOrBoolean of the first kind");
        check(outcomeOf(() => whichToStringOfNumberOrBoolean(true)), "of Boolean", "whichToStringOfNumberOrBoolean of the second kind");
        check(outcomeOf(() => hasToStringOfNumberOrBoolean(true)), "yes", "hasToStringOfNumberOrBoolean of the second kind");
        check(outcomeOf(() => whichToStringOfNumberOrSymbol(false)), "of Number", "whichToStringOfNumberOrSymbol of the first kind");
        check(outcomeOf(() => hasToStringOfNumberOrSymbol(false)), "yes", "hasToStringOfNumberOrSymbol of the first kind");
        check(outcomeOf(() => whichToStringOfNumberOrSymbol(true)), "of Symbol", "whichToStringOfNumberOrSymbol of the second kind");
        check(outcomeOf(() => hasToStringOfNumberOrSymbol(true)), "yes", "hasToStringOfNumberOrSymbol of the second kind");
        check(outcomeOf(() => whichToStringOfNumberOrBigInt(false)), "of Number", "whichToStringOfNumberOrBigInt of the first kind");
        check(outcomeOf(() => hasToStringOfNumberOrBigInt(false)), "yes", "hasToStringOfNumberOrBigInt of the first kind");
        check(outcomeOf(() => whichToStringOfNumberOrBigInt(true)), "of BigInt", "whichToStringOfNumberOrBigInt of the second kind");
        check(outcomeOf(() => hasToStringOfNumberOrBigInt(true)), "yes", "hasToStringOfNumberOrBigInt of the second kind");
        check(outcomeOf(() => whichToStringOfNumberOrPlainObject(false)), "of Number", "whichToStringOfNumberOrPlainObject of the first kind");
        check(outcomeOf(() => hasToStringOfNumberOrPlainObject(false)), "yes", "hasToStringOfNumberOrPlainObject of the first kind");
        check(outcomeOf(() => whichToStringOfNumberOrPlainObject(true)), "of Object", "whichToStringOfNumberOrPlainObject of the second kind");
        check(outcomeOf(() => hasToStringOfNumberOrPlainObject(true)), "yes", "hasToStringOfNumberOrPlainObject of the second kind");
        check(outcomeOf(() => whichToStringOfNumberOrObjectWithItsOwn(false)), "of Number", "whichToStringOfNumberOrObjectWithItsOwn of the first kind");
        check(outcomeOf(() => hasToStringOfNumberOrObjectWithItsOwn(false)), "yes", "hasToStringOfNumberOrObjectWithItsOwn of the first kind");
        check(outcomeOf(() => whichToStringOfNumberOrObjectWithItsOwn(true)), "its own", "whichToStringOfNumberOrObjectWithItsOwn of the second kind");
        check(outcomeOf(() => hasToStringOfNumberOrObjectWithItsOwn(true)), "no", "hasToStringOfNumberOrObjectWithItsOwn of the second kind");
        check(outcomeOf(() => whichToStringOfNumberOrNull(false)), "of Number", "whichToStringOfNumberOrNull of the first kind");
        check(outcomeOf(() => hasToStringOfNumberOrNull(false)), "yes", "hasToStringOfNumberOrNull of the first kind");
        check(outcomeOf(() => whichToStringOfNumberOrNull(true)), "TypeError", "whichToStringOfNumberOrNull of the second kind");
        check(outcomeOf(() => hasToStringOfNumberOrNull(true)), "TypeError", "hasToStringOfNumberOrNull of the second kind");
        check(outcomeOf(() => whichToStringOfNumberOrUndefined(false)), "of Number", "whichToStringOfNumberOrUndefined of the first kind");
        check(outcomeOf(() => hasToStringOfNumberOrUndefined(false)), "yes", "hasToStringOfNumberOrUndefined of the first kind");
        check(outcomeOf(() => whichToStringOfNumberOrUndefined(true)), "TypeError", "whichToStringOfNumberOrUndefined of the second kind");
        check(outcomeOf(() => hasToStringOfNumberOrUndefined(true)), "TypeError", "hasToStringOfNumberOrUndefined of the second kind");
        check(outcomeOf(() => whichToFixedOfInt32(false)), "of Number", "whichToFixedOfInt32 of the first kind");
        check(outcomeOf(() => hasToFixedOfInt32(false)), "yes", "hasToFixedOfInt32 of the first kind");
        check(outcomeOf(() => whichToFixedOfInt32OrString(false)), "of Number", "whichToFixedOfInt32OrString of the first kind");
        check(outcomeOf(() => hasToFixedOfInt32OrString(false)), "yes", "hasToFixedOfInt32OrString of the first kind");
        check(outcomeOf(() => whichToFixedOfInt32OrString(true)), "undefined", "whichToFixedOfInt32OrString of the second kind");
        check(outcomeOf(() => hasToFixedOfInt32OrString(true)), "no", "hasToFixedOfInt32OrString of the second kind");
        check(outcomeOf(() => whichToFixedOfInt32OrBoolean(false)), "of Number", "whichToFixedOfInt32OrBoolean of the first kind");
        check(outcomeOf(() => hasToFixedOfInt32OrBoolean(false)), "yes", "hasToFixedOfInt32OrBoolean of the first kind");
        check(outcomeOf(() => whichToFixedOfInt32OrBoolean(true)), "undefined", "whichToFixedOfInt32OrBoolean of the second kind");
        check(outcomeOf(() => hasToFixedOfInt32OrBoolean(true)), "no", "hasToFixedOfInt32OrBoolean of the second kind");
        check(outcomeOf(() => whichToFixedOfInt32OrSymbol(false)), "of Number", "whichToFixedOfInt32OrSymbol of the first kind");
        check(outcomeOf(() => hasToFixedOfInt32OrSymbol(false)), "yes", "hasToFixedOfInt32OrSymbol of the first kind");
        check(outcomeOf(() => whichToFixedOfInt32OrSymbol(true)), "undefined", "whichToFixedOfInt32OrSymbol of the second kind");
        check(outcomeOf(() => hasToFixedOfInt32OrSymbol(true)), "no", "hasToFixedOfInt32OrSymbol of the second kind");
        check(outcomeOf(() => whichToFixedOfInt32OrBigInt(false)), "of Number", "whichToFixedOfInt32OrBigInt of the first kind");
        check(outcomeOf(() => hasToFixedOfInt32OrBigInt(false)), "yes", "hasToFixedOfInt32OrBigInt of the first kind");
        check(outcomeOf(() => whichToFixedOfInt32OrBigInt(true)), "undefined", "whichToFixedOfInt32OrBigInt of the second kind");
        check(outcomeOf(() => hasToFixedOfInt32OrBigInt(true)), "no", "hasToFixedOfInt32OrBigInt of the second kind");
        check(outcomeOf(() => whichToFixedOfInt32OrPlainObject(false)), "of Number", "whichToFixedOfInt32OrPlainObject of the first kind");
        check(outcomeOf(() => hasToFixedOfInt32OrPlainObject(false)), "yes", "hasToFixedOfInt32OrPlainObject of the first kind");
        check(outcomeOf(() => whichToFixedOfInt32OrPlainObject(true)), "undefined", "whichToFixedOfInt32OrPlainObject of the second kind");
        check(outcomeOf(() => hasToFixedOfInt32OrPlainObject(true)), "no", "hasToFixedOfInt32OrPlainObject of the second kind");
        check(outcomeOf(() => whichToFixedOfInt32OrObjectWithItsOwn(false)), "of Number", "whichToFixedOfInt32OrObjectWithItsOwn of the first kind");
        check(outcomeOf(() => hasToFixedOfInt32OrObjectWithItsOwn(false)), "yes", "hasToFixedOfInt32OrObjectWithItsOwn of the first kind");
        check(outcomeOf(() => whichToFixedOfInt32OrObjectWithItsOwn(true)), "its own", "whichToFixedOfInt32OrObjectWithItsOwn of the second kind");
        check(outcomeOf(() => hasToFixedOfInt32OrObjectWithItsOwn(true)), "no", "hasToFixedOfInt32OrObjectWithItsOwn of the second kind");
        check(outcomeOf(() => whichToFixedOfInt32OrNull(false)), "of Number", "whichToFixedOfInt32OrNull of the first kind");
        check(outcomeOf(() => hasToFixedOfInt32OrNull(false)), "yes", "hasToFixedOfInt32OrNull of the first kind");
        check(outcomeOf(() => whichToFixedOfInt32OrNull(true)), "TypeError", "whichToFixedOfInt32OrNull of the second kind");
        check(outcomeOf(() => hasToFixedOfInt32OrNull(true)), "TypeError", "hasToFixedOfInt32OrNull of the second kind");
        check(outcomeOf(() => whichToFixedOfInt32OrUndefined(false)), "of Number", "whichToFixedOfInt32OrUndefined of the first kind");
        check(outcomeOf(() => hasToFixedOfInt32OrUndefined(false)), "yes", "hasToFixedOfInt32OrUndefined of the first kind");
        check(outcomeOf(() => whichToFixedOfInt32OrUndefined(true)), "TypeError", "whichToFixedOfInt32OrUndefined of the second kind");
        check(outcomeOf(() => hasToFixedOfInt32OrUndefined(true)), "TypeError", "hasToFixedOfInt32OrUndefined of the second kind");
        check(outcomeOf(() => whichTrimOfString(false)), "of String", "whichTrimOfString of the first kind");
        check(outcomeOf(() => hasTrimOfString(false)), "yes", "hasTrimOfString of the first kind");
        check(outcomeOf(() => whichTrimOfStringOrNumber(false)), "of String", "whichTrimOfStringOrNumber of the first kind");
        check(outcomeOf(() => hasTrimOfStringOrNumber(false)), "yes", "hasTrimOfStringOrNumber of the first kind");
        check(outcomeOf(() => whichTrimOfStringOrNumber(true)), "undefined", "whichTrimOfStringOrNumber of the second kind");
        check(outcomeOf(() => hasTrimOfStringOrNumber(true)), "no", "hasTrimOfStringOrNumber of the second kind");
        check(outcomeOf(() => whichTrimOfStringOrInt32(false)), "of String", "whichTrimOfStringOrInt32 of the first kind");
        check(outcomeOf(() => hasTrimOfStringOrInt32(false)), "yes", "hasTrimOfStringOrInt32 of the first kind");
        check(outcomeOf(() => whichTrimOfStringOrInt32(true)), "undefined", "whichTrimOfStringOrInt32 of the second kind");
        check(outcomeOf(() => hasTrimOfStringOrInt32(true)), "no", "hasTrimOfStringOrInt32 of the second kind");
        check(outcomeOf(() => whichTrimOfStringOrBoolean(false)), "of String", "whichTrimOfStringOrBoolean of the first kind");
        check(outcomeOf(() => hasTrimOfStringOrBoolean(false)), "yes", "hasTrimOfStringOrBoolean of the first kind");
        check(outcomeOf(() => whichTrimOfStringOrBoolean(true)), "undefined", "whichTrimOfStringOrBoolean of the second kind");
        check(outcomeOf(() => hasTrimOfStringOrBoolean(true)), "no", "hasTrimOfStringOrBoolean of the second kind");
        check(outcomeOf(() => whichTrimOfStringOrSymbol(false)), "of String", "whichTrimOfStringOrSymbol of the first kind");
        check(outcomeOf(() => hasTrimOfStringOrSymbol(false)), "yes", "hasTrimOfStringOrSymbol of the first kind");
        check(outcomeOf(() => whichTrimOfStringOrSymbol(true)), "undefined", "whichTrimOfStringOrSymbol of the second kind");
        check(outcomeOf(() => hasTrimOfStringOrSymbol(true)), "no", "hasTrimOfStringOrSymbol of the second kind");
        check(outcomeOf(() => whichTrimOfStringOrBigInt(false)), "of String", "whichTrimOfStringOrBigInt of the first kind");
        check(outcomeOf(() => hasTrimOfStringOrBigInt(false)), "yes", "hasTrimOfStringOrBigInt of the first kind");
        check(outcomeOf(() => whichTrimOfStringOrBigInt(true)), "undefined", "whichTrimOfStringOrBigInt of the second kind");
        check(outcomeOf(() => hasTrimOfStringOrBigInt(true)), "no", "hasTrimOfStringOrBigInt of the second kind");
        check(outcomeOf(() => whichTrimOfStringOrPlainObject(false)), "of String", "whichTrimOfStringOrPlainObject of the first kind");
        check(outcomeOf(() => hasTrimOfStringOrPlainObject(false)), "yes", "hasTrimOfStringOrPlainObject of the first kind");
        check(outcomeOf(() => whichTrimOfStringOrPlainObject(true)), "undefined", "whichTrimOfStringOrPlainObject of the second kind");
        check(outcomeOf(() => hasTrimOfStringOrPlainObject(true)), "no", "hasTrimOfStringOrPlainObject of the second kind");
        check(outcomeOf(() => whichTrimOfStringOrObjectWithItsOwn(false)), "of String", "whichTrimOfStringOrObjectWithItsOwn of the first kind");
        check(outcomeOf(() => hasTrimOfStringOrObjectWithItsOwn(false)), "yes", "hasTrimOfStringOrObjectWithItsOwn of the first kind");
        check(outcomeOf(() => whichTrimOfStringOrObjectWithItsOwn(true)), "its own", "whichTrimOfStringOrObjectWithItsOwn of the second kind");
        check(outcomeOf(() => hasTrimOfStringOrObjectWithItsOwn(true)), "no", "hasTrimOfStringOrObjectWithItsOwn of the second kind");
        check(outcomeOf(() => whichTrimOfStringOrNull(false)), "of String", "whichTrimOfStringOrNull of the first kind");
        check(outcomeOf(() => hasTrimOfStringOrNull(false)), "yes", "hasTrimOfStringOrNull of the first kind");
        check(outcomeOf(() => whichTrimOfStringOrNull(true)), "TypeError", "whichTrimOfStringOrNull of the second kind");
        check(outcomeOf(() => hasTrimOfStringOrNull(true)), "TypeError", "hasTrimOfStringOrNull of the second kind");
        check(outcomeOf(() => whichTrimOfStringOrUndefined(false)), "of String", "whichTrimOfStringOrUndefined of the first kind");
        check(outcomeOf(() => hasTrimOfStringOrUndefined(false)), "yes", "hasTrimOfStringOrUndefined of the first kind");
        check(outcomeOf(() => whichTrimOfStringOrUndefined(true)), "TypeError", "whichTrimOfStringOrUndefined of the second kind");
        check(outcomeOf(() => hasTrimOfStringOrUndefined(true)), "TypeError", "hasTrimOfStringOrUndefined of the second kind");
        check(outcomeOf(() => whichToStringOfString(false)), "of String", "whichToStringOfString of the first kind");
        check(outcomeOf(() => hasToStringOfString(false)), "yes", "hasToStringOfString of the first kind");
        check(outcomeOf(() => whichToStringOfStringOrNumber(false)), "of String", "whichToStringOfStringOrNumber of the first kind");
        check(outcomeOf(() => hasToStringOfStringOrNumber(false)), "yes", "hasToStringOfStringOrNumber of the first kind");
        check(outcomeOf(() => whichToStringOfStringOrNumber(true)), "of Number", "whichToStringOfStringOrNumber of the second kind");
        check(outcomeOf(() => hasToStringOfStringOrNumber(true)), "yes", "hasToStringOfStringOrNumber of the second kind");
        check(outcomeOf(() => whichToStringOfStringOrInt32(false)), "of String", "whichToStringOfStringOrInt32 of the first kind");
        check(outcomeOf(() => hasToStringOfStringOrInt32(false)), "yes", "hasToStringOfStringOrInt32 of the first kind");
        check(outcomeOf(() => whichToStringOfStringOrInt32(true)), "of Number", "whichToStringOfStringOrInt32 of the second kind");
        check(outcomeOf(() => hasToStringOfStringOrInt32(true)), "yes", "hasToStringOfStringOrInt32 of the second kind");
        check(outcomeOf(() => whichToStringOfStringOrBoolean(false)), "of String", "whichToStringOfStringOrBoolean of the first kind");
        check(outcomeOf(() => hasToStringOfStringOrBoolean(false)), "yes", "hasToStringOfStringOrBoolean of the first kind");
        check(outcomeOf(() => whichToStringOfStringOrBoolean(true)), "of Boolean", "whichToStringOfStringOrBoolean of the second kind");
        check(outcomeOf(() => hasToStringOfStringOrBoolean(true)), "yes", "hasToStringOfStringOrBoolean of the second kind");
        check(outcomeOf(() => whichToStringOfStringOrSymbol(false)), "of String", "whichToStringOfStringOrSymbol of the first kind");
        check(outcomeOf(() => hasToStringOfStringOrSymbol(false)), "yes", "hasToStringOfStringOrSymbol of the first kind");
        check(outcomeOf(() => whichToStringOfStringOrSymbol(true)), "of Symbol", "whichToStringOfStringOrSymbol of the second kind");
        check(outcomeOf(() => hasToStringOfStringOrSymbol(true)), "yes", "hasToStringOfStringOrSymbol of the second kind");
        check(outcomeOf(() => whichToStringOfStringOrBigInt(false)), "of String", "whichToStringOfStringOrBigInt of the first kind");
        check(outcomeOf(() => hasToStringOfStringOrBigInt(false)), "yes", "hasToStringOfStringOrBigInt of the first kind");
        check(outcomeOf(() => whichToStringOfStringOrBigInt(true)), "of BigInt", "whichToStringOfStringOrBigInt of the second kind");
        check(outcomeOf(() => hasToStringOfStringOrBigInt(true)), "yes", "hasToStringOfStringOrBigInt of the second kind");
        check(outcomeOf(() => whichToStringOfStringOrPlainObject(false)), "of String", "whichToStringOfStringOrPlainObject of the first kind");
        check(outcomeOf(() => hasToStringOfStringOrPlainObject(false)), "yes", "hasToStringOfStringOrPlainObject of the first kind");
        check(outcomeOf(() => whichToStringOfStringOrPlainObject(true)), "of Object", "whichToStringOfStringOrPlainObject of the second kind");
        check(outcomeOf(() => hasToStringOfStringOrPlainObject(true)), "yes", "hasToStringOfStringOrPlainObject of the second kind");
        check(outcomeOf(() => whichToStringOfStringOrObjectWithItsOwn(false)), "of String", "whichToStringOfStringOrObjectWithItsOwn of the first kind");
        check(outcomeOf(() => hasToStringOfStringOrObjectWithItsOwn(false)), "yes", "hasToStringOfStringOrObjectWithItsOwn of the first kind");
        check(outcomeOf(() => whichToStringOfStringOrObjectWithItsOwn(true)), "its own", "whichToStringOfStringOrObjectWithItsOwn of the second kind");
        check(outcomeOf(() => hasToStringOfStringOrObjectWithItsOwn(true)), "no", "hasToStringOfStringOrObjectWithItsOwn of the second kind");
        check(outcomeOf(() => whichToStringOfStringOrNull(false)), "of String", "whichToStringOfStringOrNull of the first kind");
        check(outcomeOf(() => hasToStringOfStringOrNull(false)), "yes", "hasToStringOfStringOrNull of the first kind");
        check(outcomeOf(() => whichToStringOfStringOrNull(true)), "TypeError", "whichToStringOfStringOrNull of the second kind");
        check(outcomeOf(() => hasToStringOfStringOrNull(true)), "TypeError", "hasToStringOfStringOrNull of the second kind");
        check(outcomeOf(() => whichToStringOfStringOrUndefined(false)), "of String", "whichToStringOfStringOrUndefined of the first kind");
        check(outcomeOf(() => hasToStringOfStringOrUndefined(false)), "yes", "hasToStringOfStringOrUndefined of the first kind");
        check(outcomeOf(() => whichToStringOfStringOrUndefined(true)), "TypeError", "whichToStringOfStringOrUndefined of the second kind");
        check(outcomeOf(() => hasToStringOfStringOrUndefined(true)), "TypeError", "hasToStringOfStringOrUndefined of the second kind");
        check(outcomeOf(() => whichToStringOfBoolean(false)), "of Boolean", "whichToStringOfBoolean of the first kind");
        check(outcomeOf(() => hasToStringOfBoolean(false)), "yes", "hasToStringOfBoolean of the first kind");
        check(outcomeOf(() => whichToStringOfBooleanOrNumber(false)), "of Boolean", "whichToStringOfBooleanOrNumber of the first kind");
        check(outcomeOf(() => hasToStringOfBooleanOrNumber(false)), "yes", "hasToStringOfBooleanOrNumber of the first kind");
        check(outcomeOf(() => whichToStringOfBooleanOrNumber(true)), "of Number", "whichToStringOfBooleanOrNumber of the second kind");
        check(outcomeOf(() => hasToStringOfBooleanOrNumber(true)), "yes", "hasToStringOfBooleanOrNumber of the second kind");
        check(outcomeOf(() => whichToStringOfBooleanOrInt32(false)), "of Boolean", "whichToStringOfBooleanOrInt32 of the first kind");
        check(outcomeOf(() => hasToStringOfBooleanOrInt32(false)), "yes", "hasToStringOfBooleanOrInt32 of the first kind");
        check(outcomeOf(() => whichToStringOfBooleanOrInt32(true)), "of Number", "whichToStringOfBooleanOrInt32 of the second kind");
        check(outcomeOf(() => hasToStringOfBooleanOrInt32(true)), "yes", "hasToStringOfBooleanOrInt32 of the second kind");
        check(outcomeOf(() => whichToStringOfBooleanOrString(false)), "of Boolean", "whichToStringOfBooleanOrString of the first kind");
        check(outcomeOf(() => hasToStringOfBooleanOrString(false)), "yes", "hasToStringOfBooleanOrString of the first kind");
        check(outcomeOf(() => whichToStringOfBooleanOrString(true)), "of String", "whichToStringOfBooleanOrString of the second kind");
        check(outcomeOf(() => hasToStringOfBooleanOrString(true)), "yes", "hasToStringOfBooleanOrString of the second kind");
        check(outcomeOf(() => whichToStringOfBooleanOrSymbol(false)), "of Boolean", "whichToStringOfBooleanOrSymbol of the first kind");
        check(outcomeOf(() => hasToStringOfBooleanOrSymbol(false)), "yes", "hasToStringOfBooleanOrSymbol of the first kind");
        check(outcomeOf(() => whichToStringOfBooleanOrSymbol(true)), "of Symbol", "whichToStringOfBooleanOrSymbol of the second kind");
        check(outcomeOf(() => hasToStringOfBooleanOrSymbol(true)), "yes", "hasToStringOfBooleanOrSymbol of the second kind");
        check(outcomeOf(() => whichToStringOfBooleanOrBigInt(false)), "of Boolean", "whichToStringOfBooleanOrBigInt of the first kind");
        check(outcomeOf(() => hasToStringOfBooleanOrBigInt(false)), "yes", "hasToStringOfBooleanOrBigInt of the first kind");
        check(outcomeOf(() => whichToStringOfBooleanOrBigInt(true)), "of BigInt", "whichToStringOfBooleanOrBigInt of the second kind");
        check(outcomeOf(() => hasToStringOfBooleanOrBigInt(true)), "yes", "hasToStringOfBooleanOrBigInt of the second kind");
        check(outcomeOf(() => whichToStringOfBooleanOrPlainObject(false)), "of Boolean", "whichToStringOfBooleanOrPlainObject of the first kind");
        check(outcomeOf(() => hasToStringOfBooleanOrPlainObject(false)), "yes", "hasToStringOfBooleanOrPlainObject of the first kind");
        check(outcomeOf(() => whichToStringOfBooleanOrPlainObject(true)), "of Object", "whichToStringOfBooleanOrPlainObject of the second kind");
        check(outcomeOf(() => hasToStringOfBooleanOrPlainObject(true)), "yes", "hasToStringOfBooleanOrPlainObject of the second kind");
        check(outcomeOf(() => whichToStringOfBooleanOrObjectWithItsOwn(false)), "of Boolean", "whichToStringOfBooleanOrObjectWithItsOwn of the first kind");
        check(outcomeOf(() => hasToStringOfBooleanOrObjectWithItsOwn(false)), "yes", "hasToStringOfBooleanOrObjectWithItsOwn of the first kind");
        check(outcomeOf(() => whichToStringOfBooleanOrObjectWithItsOwn(true)), "its own", "whichToStringOfBooleanOrObjectWithItsOwn of the second kind");
        check(outcomeOf(() => hasToStringOfBooleanOrObjectWithItsOwn(true)), "no", "hasToStringOfBooleanOrObjectWithItsOwn of the second kind");
        check(outcomeOf(() => whichToStringOfBooleanOrNull(false)), "of Boolean", "whichToStringOfBooleanOrNull of the first kind");
        check(outcomeOf(() => hasToStringOfBooleanOrNull(false)), "yes", "hasToStringOfBooleanOrNull of the first kind");
        check(outcomeOf(() => whichToStringOfBooleanOrNull(true)), "TypeError", "whichToStringOfBooleanOrNull of the second kind");
        check(outcomeOf(() => hasToStringOfBooleanOrNull(true)), "TypeError", "hasToStringOfBooleanOrNull of the second kind");
        check(outcomeOf(() => whichToStringOfBooleanOrUndefined(false)), "of Boolean", "whichToStringOfBooleanOrUndefined of the first kind");
        check(outcomeOf(() => hasToStringOfBooleanOrUndefined(false)), "yes", "hasToStringOfBooleanOrUndefined of the first kind");
        check(outcomeOf(() => whichToStringOfBooleanOrUndefined(true)), "TypeError", "whichToStringOfBooleanOrUndefined of the second kind");
        check(outcomeOf(() => hasToStringOfBooleanOrUndefined(true)), "TypeError", "hasToStringOfBooleanOrUndefined of the second kind");
        check(outcomeOf(() => whichToStringOfSymbol(false)), "of Symbol", "whichToStringOfSymbol of the first kind");
        check(outcomeOf(() => hasToStringOfSymbol(false)), "yes", "hasToStringOfSymbol of the first kind");
        check(outcomeOf(() => whichToStringOfSymbolOrNumber(false)), "of Symbol", "whichToStringOfSymbolOrNumber of the first kind");
        check(outcomeOf(() => hasToStringOfSymbolOrNumber(false)), "yes", "hasToStringOfSymbolOrNumber of the first kind");
        check(outcomeOf(() => whichToStringOfSymbolOrNumber(true)), "of Number", "whichToStringOfSymbolOrNumber of the second kind");
        check(outcomeOf(() => hasToStringOfSymbolOrNumber(true)), "yes", "hasToStringOfSymbolOrNumber of the second kind");
        check(outcomeOf(() => whichToStringOfSymbolOrInt32(false)), "of Symbol", "whichToStringOfSymbolOrInt32 of the first kind");
        check(outcomeOf(() => hasToStringOfSymbolOrInt32(false)), "yes", "hasToStringOfSymbolOrInt32 of the first kind");
        check(outcomeOf(() => whichToStringOfSymbolOrInt32(true)), "of Number", "whichToStringOfSymbolOrInt32 of the second kind");
        check(outcomeOf(() => hasToStringOfSymbolOrInt32(true)), "yes", "hasToStringOfSymbolOrInt32 of the second kind");
        check(outcomeOf(() => whichToStringOfSymbolOrString(false)), "of Symbol", "whichToStringOfSymbolOrString of the first kind");
        check(outcomeOf(() => hasToStringOfSymbolOrString(false)), "yes", "hasToStringOfSymbolOrString of the first kind");
        check(outcomeOf(() => whichToStringOfSymbolOrString(true)), "of String", "whichToStringOfSymbolOrString of the second kind");
        check(outcomeOf(() => hasToStringOfSymbolOrString(true)), "yes", "hasToStringOfSymbolOrString of the second kind");
        check(outcomeOf(() => whichToStringOfSymbolOrBoolean(false)), "of Symbol", "whichToStringOfSymbolOrBoolean of the first kind");
        check(outcomeOf(() => hasToStringOfSymbolOrBoolean(false)), "yes", "hasToStringOfSymbolOrBoolean of the first kind");
        check(outcomeOf(() => whichToStringOfSymbolOrBoolean(true)), "of Boolean", "whichToStringOfSymbolOrBoolean of the second kind");
        check(outcomeOf(() => hasToStringOfSymbolOrBoolean(true)), "yes", "hasToStringOfSymbolOrBoolean of the second kind");
        check(outcomeOf(() => whichToStringOfSymbolOrBigInt(false)), "of Symbol", "whichToStringOfSymbolOrBigInt of the first kind");
        check(outcomeOf(() => hasToStringOfSymbolOrBigInt(false)), "yes", "hasToStringOfSymbolOrBigInt of the first kind");
        check(outcomeOf(() => whichToStringOfSymbolOrBigInt(true)), "of BigInt", "whichToStringOfSymbolOrBigInt of the second kind");
        check(outcomeOf(() => hasToStringOfSymbolOrBigInt(true)), "yes", "hasToStringOfSymbolOrBigInt of the second kind");
        check(outcomeOf(() => whichToStringOfSymbolOrPlainObject(false)), "of Symbol", "whichToStringOfSymbolOrPlainObject of the first kind");
        check(outcomeOf(() => hasToStringOfSymbolOrPlainObject(false)), "yes", "hasToStringOfSymbolOrPlainObject of the first kind");
        check(outcomeOf(() => whichToStringOfSymbolOrPlainObject(true)), "of Object", "whichToStringOfSymbolOrPlainObject of the second kind");
        check(outcomeOf(() => hasToStringOfSymbolOrPlainObject(true)), "yes", "hasToStringOfSymbolOrPlainObject of the second kind");
        check(outcomeOf(() => whichToStringOfSymbolOrObjectWithItsOwn(false)), "of Symbol", "whichToStringOfSymbolOrObjectWithItsOwn of the first kind");
        check(outcomeOf(() => hasToStringOfSymbolOrObjectWithItsOwn(false)), "yes", "hasToStringOfSymbolOrObjectWithItsOwn of the first kind");
        check(outcomeOf(() => whichToStringOfSymbolOrObjectWithItsOwn(true)), "its own", "whichToStringOfSymbolOrObjectWithItsOwn of the second kind");
        check(outcomeOf(() => hasToStringOfSymbolOrObjectWithItsOwn(true)), "no", "hasToStringOfSymbolOrObjectWithItsOwn of the second kind");
        check(outcomeOf(() => whichToStringOfSymbolOrNull(false)), "of Symbol", "whichToStringOfSymbolOrNull of the first kind");
        check(outcomeOf(() => hasToStringOfSymbolOrNull(false)), "yes", "hasToStringOfSymbolOrNull of the first kind");
        check(outcomeOf(() => whichToStringOfSymbolOrNull(true)), "TypeError", "whichToStringOfSymbolOrNull of the second kind");
        check(outcomeOf(() => hasToStringOfSymbolOrNull(true)), "TypeError", "hasToStringOfSymbolOrNull of the second kind");
        check(outcomeOf(() => whichToStringOfSymbolOrUndefined(false)), "of Symbol", "whichToStringOfSymbolOrUndefined of the first kind");
        check(outcomeOf(() => hasToStringOfSymbolOrUndefined(false)), "yes", "hasToStringOfSymbolOrUndefined of the first kind");
        check(outcomeOf(() => whichToStringOfSymbolOrUndefined(true)), "TypeError", "whichToStringOfSymbolOrUndefined of the second kind");
        check(outcomeOf(() => hasToStringOfSymbolOrUndefined(true)), "TypeError", "hasToStringOfSymbolOrUndefined of the second kind");
        check(outcomeOf(() => whichValueOfOfNumber(false)), "of Number", "whichValueOfOfNumber of the first kind");
        check(outcomeOf(() => hasValueOfOfNumber(false)), "yes", "hasValueOfOfNumber of the first kind");
        check(outcomeOf(() => whichValueOfOfNumberOrString(false)), "of Number", "whichValueOfOfNumberOrString of the first kind");
        check(outcomeOf(() => hasValueOfOfNumberOrString(false)), "yes", "hasValueOfOfNumberOrString of the first kind");
        check(outcomeOf(() => whichValueOfOfNumberOrString(true)), "of String", "whichValueOfOfNumberOrString of the second kind");
        check(outcomeOf(() => hasValueOfOfNumberOrString(true)), "yes", "hasValueOfOfNumberOrString of the second kind");
        check(outcomeOf(() => whichValueOfOfNumberOrBoolean(false)), "of Number", "whichValueOfOfNumberOrBoolean of the first kind");
        check(outcomeOf(() => hasValueOfOfNumberOrBoolean(false)), "yes", "hasValueOfOfNumberOrBoolean of the first kind");
        check(outcomeOf(() => whichValueOfOfNumberOrBoolean(true)), "of Boolean", "whichValueOfOfNumberOrBoolean of the second kind");
        check(outcomeOf(() => hasValueOfOfNumberOrBoolean(true)), "yes", "hasValueOfOfNumberOrBoolean of the second kind");
        check(outcomeOf(() => whichValueOfOfNumberOrSymbol(false)), "of Number", "whichValueOfOfNumberOrSymbol of the first kind");
        check(outcomeOf(() => hasValueOfOfNumberOrSymbol(false)), "yes", "hasValueOfOfNumberOrSymbol of the first kind");
        check(outcomeOf(() => whichValueOfOfNumberOrSymbol(true)), "of Symbol", "whichValueOfOfNumberOrSymbol of the second kind");
        check(outcomeOf(() => hasValueOfOfNumberOrSymbol(true)), "yes", "hasValueOfOfNumberOrSymbol of the second kind");
        check(outcomeOf(() => whichValueOfOfNumberOrBigInt(false)), "of Number", "whichValueOfOfNumberOrBigInt of the first kind");
        check(outcomeOf(() => hasValueOfOfNumberOrBigInt(false)), "yes", "hasValueOfOfNumberOrBigInt of the first kind");
        check(outcomeOf(() => whichValueOfOfNumberOrBigInt(true)), "of BigInt", "whichValueOfOfNumberOrBigInt of the second kind");
        check(outcomeOf(() => hasValueOfOfNumberOrBigInt(true)), "yes", "hasValueOfOfNumberOrBigInt of the second kind");
        check(outcomeOf(() => whichValueOfOfNumberOrPlainObject(false)), "of Number", "whichValueOfOfNumberOrPlainObject of the first kind");
        check(outcomeOf(() => hasValueOfOfNumberOrPlainObject(false)), "yes", "hasValueOfOfNumberOrPlainObject of the first kind");
        check(outcomeOf(() => whichValueOfOfNumberOrPlainObject(true)), "of Object", "whichValueOfOfNumberOrPlainObject of the second kind");
        check(outcomeOf(() => hasValueOfOfNumberOrPlainObject(true)), "yes", "hasValueOfOfNumberOrPlainObject of the second kind");
        check(outcomeOf(() => whichValueOfOfNumberOrObjectWithItsOwn(false)), "of Number", "whichValueOfOfNumberOrObjectWithItsOwn of the first kind");
        check(outcomeOf(() => hasValueOfOfNumberOrObjectWithItsOwn(false)), "yes", "hasValueOfOfNumberOrObjectWithItsOwn of the first kind");
        check(outcomeOf(() => whichValueOfOfNumberOrObjectWithItsOwn(true)), "its own", "whichValueOfOfNumberOrObjectWithItsOwn of the second kind");
        check(outcomeOf(() => hasValueOfOfNumberOrObjectWithItsOwn(true)), "no", "hasValueOfOfNumberOrObjectWithItsOwn of the second kind");
        check(outcomeOf(() => whichValueOfOfNumberOrNull(false)), "of Number", "whichValueOfOfNumberOrNull of the first kind");
        check(outcomeOf(() => hasValueOfOfNumberOrNull(false)), "yes", "hasValueOfOfNumberOrNull of the first kind");
        check(outcomeOf(() => whichValueOfOfNumberOrNull(true)), "TypeError", "whichValueOfOfNumberOrNull of the second kind");
        check(outcomeOf(() => hasValueOfOfNumberOrNull(true)), "TypeError", "hasValueOfOfNumberOrNull of the second kind");
        check(outcomeOf(() => whichValueOfOfNumberOrUndefined(false)), "of Number", "whichValueOfOfNumberOrUndefined of the first kind");
        check(outcomeOf(() => hasValueOfOfNumberOrUndefined(false)), "yes", "hasValueOfOfNumberOrUndefined of the first kind");
        check(outcomeOf(() => whichValueOfOfNumberOrUndefined(true)), "TypeError", "whichValueOfOfNumberOrUndefined of the second kind");
        check(outcomeOf(() => hasValueOfOfNumberOrUndefined(true)), "TypeError", "hasValueOfOfNumberOrUndefined of the second kind");
    }

    function truthinessOfAnything(x) { return x ? "yes" : "no"; }
    check([0, "s", null, plainObject].map(x => truthinessOfAnything(x)).join(), "no,yes,no,yes", "the truthiness of anything");
}
test();
if (failures.length)
    throw new Error(failures.length + " failures:\n" + failures.slice(0, 40).join("\n"));
console.log("passed");
