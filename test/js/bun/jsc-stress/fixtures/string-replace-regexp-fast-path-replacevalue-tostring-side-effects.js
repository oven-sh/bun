// @bun
function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error(`bad value: ${actual}, expected ${expected}`);
}

// RegExp.prototype[@@replace] runs ToString(replaceValue) (step 6) before it reads flags (step 7)
// and calls exec (step 12). A toString that changes the RegExp must be observed by those steps,
// on the host function and on the DFG/FTL operations behind String.prototype.replace.

// An own exec installed by toString is called.
function ownExec(replace) {
    let re = /a/g;
    let execCalls = 0;
    let result = replace("aaa", re, {
        toString() {
            re.exec = function() {
                execCalls++;
                return null;
            };
            return "b";
        }
    });
    shouldBe(result, "aaa");
    shouldBe(execCalls, 1);
}

// An own flags property installed by toString is read: "" makes the replacement non-global.
function ownFlags(replace) {
    let re = /a/g;
    let result = replace("aaa", re, {
        toString() {
            Object.defineProperty(re, "flags", { value: "" });
            return "b";
        }
    });
    shouldBe(result, "baa");
}

// A lastIndex object installed by toString is read through ToLength.
function lastIndexObject(replace) {
    let re = /a/;
    let valueOfCalls = 0;
    let result = replace("aaa", re, {
        toString() {
            re.lastIndex = { valueOf() { valueOfCalls++; return 1; } };
            return "b";
        }
    });
    shouldBe(result, "baa");
    shouldBe(valueOfCalls, 1);
}

// The toString of replaceValue runs once, also when the generic path takes over.
function toStringRunsOnce(replace) {
    let re = /a/g;
    let toStringCalls = 0;
    let result = replace("aaa", re, {
        toString() {
            toStringCalls++;
            re.exec = RegExp.prototype.exec;
            return "b";
        }
    });
    shouldBe(result, "bbb");
    shouldBe(toStringCalls, 1);
}

// An own exec that the toString of |this| installs is called (DFG generic operation).
function thisToStringOwnExec(replace) {
    let re = /a/g;
    let execCalls = 0;
    let thisValue = {
        toString() {
            re.exec = function() {
                execCalls++;
                return null;
            };
            return "aaa";
        }
    };
    let result = replace(thisValue, re, "b");
    shouldBe(result, "aaa");
    shouldBe(execCalls, 1);
}

function replace(string, re, value) {
    return string.replace(re, value);
}
noInline(replace);

function replaceAll(string, re, value) {
    return string.replaceAll(re, value);
}
noInline(replaceAll);

function replaceCall(thisValue, re, value) {
    return String.prototype.replace.call(thisValue, re, value);
}
noInline(replaceCall);

function replaceAllCall(thisValue, re, value) {
    return String.prototype.replaceAll.call(thisValue, re, value);
}
noInline(replaceAllCall);

for (let i = 0; i < testLoopCount; ++i) {
    ownExec(replace);
    ownExec(replaceAll);
    ownFlags(replace);
    ownFlags(replaceAll);
    lastIndexObject(replace);
    toStringRunsOnce(replace);
    toStringRunsOnce(replaceAll);
    thisToStringOwnExec(replaceCall);
    thisToStringOwnExec(replaceAllCall);
}
