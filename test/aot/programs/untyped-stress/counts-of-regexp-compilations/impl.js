const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;

function check(actual, expected, what)
{
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

const isCounting = typeof aotOperationCount === "function" && !!aotRemarks("check") && !!jscOptions().useAOTOperationCounters;

function compilations()
{
    return isCounting ? aotOperationCount("RegExp::compile") || 0 : 0;
}

function patternOf(length, which)
{
    const parts = [];
    for (let i = 0, total = 4; total < length; ++i) {
        parts.push("w" + which + "_" + i + "[a-f" + (i % 10) + "]+x");
        total += parts[i].length + 1;
    }
    return "(?:" + parts.join("|") + ")";
}

function matchesOf(subject, pattern)
{
    let count = 0;
    for (const match of subject.matchAll(new RegExp(pattern, "g")))
        ++count;
    return count;
}
noInline(matchesOf);

function test(length, collect, staysCompiled)
{
    const patterns = [], subjects = [], rounds = 6;
    for (let which = 0; which < 8; ++which) {
        patterns.push(patternOf(length, which));
        subjects.push("w" + which + "_0abcx w" + which + "_1ffx nothing w" + which + "_2a2x");
    }
    const calls = rounds * patterns.length;
    const what = patterns.length + " patterns of " + patterns[0].length + " characters in turn, " + collect.name + " between the calls";
    const before = compilations();
    for (let i = 0; i < calls; ++i) {
        check(matchesOf(subjects[i % patterns.length], patterns[i % patterns.length]), 3, what);
        check(/noth(i)ng/.exec(subjects[0])[1], "i", "another expression in between");
        collect();
    }
    if (!isCounting)
        return;
    const compiled = compilations() - before;
    if (staysCompiled)
        check(compiled <= 2 * patterns.length, true, what + ": they stay compiled (" + compiled + " compilations in " + calls + " calls)");
    else
        check(compiled >= calls / 2, true, what + ": they are compiled anew (" + compiled + " compilations in " + calls + " calls)");
}

for (const collect of [edenGC, fullGC]) {
    test(113, collect, true);
    test(4200, collect, false);
}

function usesOneExpression(subject)
{
    return /on(e)+ expression/.test(subject);
}
noInline(usesOneExpression);

const beforeFirstUse = compilations();
check(usesOneExpression("one expression"), true, "a literal");
if (isCounting)
    check(compilations() - beforeFirstUse, 1, "a literal counts when it is first used");
const afterFirstUse = compilations();
for (let i = 0; i < 100; ++i)
    check(usesOneExpression("one expression"), true, "a literal");
check(compilations() - afterFirstUse, 0, "and not when it is used again");

function guests(kind)
{
    return isCounting ? aotOperationCount("guest:" + kind) || 0 : 0;
}

function usesAnotherLiteral(subject)
{
    return /anoth(e)r+ literal/.test(subject);
}
noInline(usesAnotherLiteral);

function usesPatternMadeAtRunTime(subject, pattern)
{
    return new RegExp(pattern).test(subject);
}
noInline(usesPatternMadeAtRunTime);

for (const kind of ["RegExp", "RegExp-pattern"]) {
    const beforeLiteral = guests(kind);
    check(usesAnotherLiteral("another literal"), true, "a literal");
    check(guests(kind) - beforeLiteral, 0, "a literal of the program is no guest (" + kind + ")");
}
const made = ["RegExp", "RegExp-pattern"].map(guests);
check(usesPatternMadeAtRunTime("made at run time", "made( at)+ run" + String(" time")), true, "a pattern made at run time");
if (isCounting) {
    check(guests("RegExp") - made[0] >= 1, true, "a pattern made at run time is a guest, by who compiled it");
    check(guests("RegExp-pattern") - made[1], guests("RegExp") - made[0], "and as often by its text");
}
console.log("passed");
