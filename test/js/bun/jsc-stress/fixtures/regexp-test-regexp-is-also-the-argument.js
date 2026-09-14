// @bun
//@ runDefault("--useConcurrentJIT=0")

function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error(`bad value: ${actual}, expected ${expected}`);
}

// The RegExp is also the argument, so both operands of RegExpTest are the same node and get the
// same register. The input is the source text of the RegExp, for example "/abc/".
function test(regExp) {
    return regExp.test(regExp);
}
noInline(test);

var constant = /abcdef/;
function testConstant() {
    return constant.test(constant);
}
noInline(testConstant);

var constantAnchored = /^abc/;
function testConstantAnchored() {
    return constantAnchored.test(constantAnchored);
}
noInline(testConstantAnchored);

var constantSticky = /\/ab/y;
function testConstantSticky() {
    return constantSticky.test(constantSticky);
}
noInline(testConstantSticky);

var matches = /abc/;
var anchored = /^abc$/;
var longerThanItsSource = /.{20}/;
var global = /abc/g;

for (var i = 0; i < testLoopCount; ++i) {
    shouldBe(test(matches), true);
    shouldBe(test(anchored), false);
    shouldBe(test(longerThanItsSource), false);

    global.lastIndex = 0;
    shouldBe(test(global), true);
    shouldBe(global.lastIndex, 4);
    shouldBe(test(global), false);
    shouldBe(global.lastIndex, 0);

    shouldBe(testConstant(), true);
    shouldBe(testConstantAnchored(), false);

    // The source text is "/\/ab/y". "/ab" is at index 2.
    constantSticky.lastIndex = 0;
    shouldBe(testConstantSticky(), false);
    shouldBe(constantSticky.lastIndex, 0);
    constantSticky.lastIndex = 2;
    shouldBe(testConstantSticky(), true);
    shouldBe(constantSticky.lastIndex, 5);
}
