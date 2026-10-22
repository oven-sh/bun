// The shape of a parser that peggy generates: every rule answers { success: true, value, remainder, .. } or { success: false, remainder, .. }, and every caller asks
// `result.success === false` first. A rule for an optional part always succeeds. Once its body is taken into the caller, the arm of the failure has no object left that could reach it,
// while its read of `remainder` was resolved for the failures alone: such programs did not build (InvalidGuard at the final verification).
function literal(text, expected) {
    if (text.startsWith(expected))
        return { success: true, value: expected, remainder: text.slice(expected.length), failedExpectations: [] };
    return { success: false, remainder: text, failedExpectations: [{ expectation: expected, remainder: text }] };
}
function optionalSign(text) {
    const result = literal(text, "-");
    if (result.success === true)
        return result;
    return { success: true, value: null, remainder: text, failedExpectations: result.failedExpectations };
}
function digit(text) {
    for (const expected of ["0", "1", "2", "3"]) {
        const result = literal(text, expected);
        if (result.success === true)
            return result;
    }
    return { success: false, remainder: text, failedExpectations: [{ expectation: "digit", remainder: text }] };
}
function signedDigit(text) {
    const failedExpectations = [];
    let remainder = text;
    const result0 = optionalSign(remainder);
    failedExpectations.push(...result0.failedExpectations);
    if (result0.success === false) {
        return {
            success: false,
            remainder: result0.remainder,
            failedExpectations,
        };
    }
    remainder = result0.remainder;
    const result1 = digit(remainder);
    failedExpectations.push(...result1.failedExpectations);
    if (result1.success === false) {
        return {
            success: false,
            remainder: result1.remainder,
            failedExpectations,
        };
    }
    remainder = result1.remainder;
    return {
        success: true,
        value: [result0.value, result1.value],
        remainder,
        failedExpectations,
    };
}
function pair(text) {
    const failedExpectations = [];
    const result0 = signedDigit(text);
    failedExpectations.push(...result0.failedExpectations);
    if (result0.success === false)
        return { success: false, remainder: result0.remainder, failedExpectations };
    const result1 = optionalSign(result0.remainder);
    failedExpectations.push(...result1.failedExpectations);
    if (result1.success === false)
        return { success: false, remainder: result1.remainder, failedExpectations };
    return { success: true, value: [result0.value, result1.value], remainder: result1.remainder, failedExpectations };
}
for (const text of ["-1", "2", "-", "x", "", "-3-", "1-rest", "--"])
    console.log(JSON.stringify(text), JSON.stringify(signedDigit(text)), JSON.stringify(pair(text)));
