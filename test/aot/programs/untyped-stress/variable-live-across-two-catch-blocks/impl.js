function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error(`expected ${String(expected)} but got ${String(actual)}`);
}

function make() { return { tag: "kept" }; }
function thrower(x) { throw x; }
let calls = 0;
function between() { calls++; }

function adjacent() { const x = make(); try { throw 1; } catch (a) { } try { throw 2; } catch (b) { } return x.tag; }
function separated() { const x = make(); try { throw 1; } catch (a) { } between(); try { throw 2; } catch (b) { } return x.tag; }
function three() { const x = make(); try { throw 1; } catch (a) { } between(); try { throw 2; } catch (b) { } between(); try { throw 3; } catch (c) { } return x.tag; }
function parameter(x) { try { throw 1; } catch (a) { } between(); try { throw 2; } catch (b) { } return x.tag; }
function throwsInHandler() { const x = make(); try { try { throw 1; } catch (a) { between(); throw 2; } } catch (b) { } return x.tag; }
function throwsInFinally() { const x = make(); try { try { throw 1; } finally { between(); try { throw 2; } catch (b) { } } } catch (c) { } return x.tag; }
function calleeThrows() { const x = make(); try { thrower(1); } catch (a) { } between(); try { thrower(2); } catch (b) { } return x.tag; }
function redefined() { let x = make(); try { throw 1; } catch (a) { } x = { tag: "second" }; try { throw 2; } catch (b) { } return x.tag; }
function inLoop() { const x = make(); let n = 0; for (let i = 0; i < 3; ++i) { try { throw i; } catch (a) { n += a; } between(); } try { throw 9; } catch (b) { n += b; } return x.tag + n; }
function stackIdiom() { const x = make(); let stack; try { throw new Error("here"); } catch (e) { stack = e.stack; } between(); try { JSON.parse("{"); } catch (b) { return x.tag + typeof stack; } return "no"; }
function usesGlobalAfterwards() { try { throw 1; } catch (a) { } try { throw 2; } catch (b) { } return make().tag; }

for (let i = 0; i < 100; ++i) {
    shouldBe(adjacent(), "kept");
    shouldBe(separated(), "kept");
    shouldBe(three(), "kept");
    shouldBe(parameter(make()), "kept");
    shouldBe(throwsInHandler(), "kept");
    shouldBe(throwsInFinally(), "kept");
    shouldBe(calleeThrows(), "kept");
    shouldBe(redefined(), "second");
    shouldBe(inLoop(), "kept12");
    shouldBe(stackIdiom(), "keptstring");
    shouldBe(usesGlobalAfterwards(), "kept");
}
console.log("passed");
