// A RegExp literal is a new object with lastIndex 0 at each evaluation, whichever overload of the method takes it.
function testsNumber(n) { return /\d/.test(n); }
function testsNumberGlobal(n) { return /\d/g.test(n); }
function testsObjectGlobal(o) { return /\d/g.test(o); }
function execsNumber(n) { return /\d/.exec(n)[0]; }
function execsNumberGlobal(n) { return /\d/g.exec(n).index; }
function printsItself() { return /a+/gi.toString() + /a+/gi.flags + /a+/gi.source; }
function matchesBySymbol(s) { return /\d/g[Symbol.match](s).join(); }
function replacesBySymbol(s) { return /\d/g[Symbol.replace](s, "-"); }
function searchesBySymbol(s) { return /\d/g[Symbol.search](s); }
function splitsBySymbol(s) { return /\d/g[Symbol.split](s).join("|"); }
const converted = { toString() { return testsNumberGlobal(7) ? "5" : "x"; } };
for (let round = 0; round < 3; round++) {
    console.log(testsNumber(15), testsNumberGlobal(15), testsObjectGlobal(converted), execsNumber(15), execsNumberGlobal(15));
    console.log(printsItself(), matchesBySymbol("a1b2"), replacesBySymbol("a1b2"), searchesBySymbol("a1b2"), splitsBySymbol("a1b2c"));
}
