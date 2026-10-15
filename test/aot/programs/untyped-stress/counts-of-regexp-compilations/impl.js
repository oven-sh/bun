function check(actual, expected, what)
{
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
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

function test(length, collect)
{
    const patterns = [], subjects = [], rounds = 6;
    for (let which = 0; which < 8; ++which) {
        patterns.push(patternOf(length, which));
        subjects.push("w" + which + "_0abcx w" + which + "_1ffx nothing w" + which + "_2a2x");
    }
    const calls = rounds * patterns.length;
    const what = patterns.length + " patterns of " + patterns[0].length + " characters in turn, " + collect.name + " between the calls";
    for (let i = 0; i < calls; ++i) {
        check(matchesOf(subjects[i % patterns.length], patterns[i % patterns.length]), 3, what);
        check(/noth(i)ng/.exec(subjects[0])[1], "i", "another expression in between");
        collect();
    }
}

for (const collect of [edenGC, fullGC]) {
    test(113, collect);
    test(4200, collect);
}

function usesOneExpression(subject)
{
    return /on(e)+ expression/.test(subject);
}
noInline(usesOneExpression);

check(usesOneExpression("one expression"), true, "a literal");
for (let i = 0; i < 100; ++i)
    check(usesOneExpression("one expression"), true, "a literal");

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

check(usesAnotherLiteral("another literal"), true, "a literal");
check(usesPatternMadeAtRunTime("made at run time", "made( at)+ run" + String(" time")), true, "a pattern made at run time");
console.log("passed");
