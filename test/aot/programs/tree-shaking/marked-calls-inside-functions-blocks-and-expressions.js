// A mark before a call lets it go when its result is not used, and both `bun run` and `bun build --compile` decide that while they parse, wherever the call stands: a marked call that is a statement of its own goes, in a function, a method, a static block, an arm, a loop, try, finally and a block; so does the left of a comma, an element of an array that is a statement, the operand of void and of !, an arm of ?: in a statement. A constant inside a function or a block keeps its marked call, and so does the left of &&.
const log = [];
function make(name) { log.push(name); return { name }; }
class Made { constructor(name) { log.push("new " + name); } }
function inFunction() { /* @__PURE__ */ make("a statement in a function"); const unused = /* @__PURE__ */ make("a constant in a function"); return 1; }
const inArrow = () => { /* @__PURE__ */ make("a statement in an arrow function"); };
class Holder { method() { /* @__PURE__ */ new Made("a statement in a method"); } static { /* @__PURE__ */ make("a statement in a static block"); } }
inFunction();
inArrow();
new Holder().method();
if (log.length >= 0) { /* @__PURE__ */ make("a statement in an arm"); }
for (let i = 0; i < 1; i++) { /* @__PURE__ */ make("a statement in a loop"); }
try { /* @__PURE__ */ make("a statement in try"); } finally { /* @__PURE__ */ make("a statement in finally"); }
{ /* @__PURE__ */ make("a statement in a block"); const unused = /* @__PURE__ */ make("a constant in a block"); }
(/* @__PURE__ */ make("the left of a comma"), log.push("the right of a comma"));
[/* @__PURE__ */ make("an element beside a call"), log.push("the call beside it")];
void /* @__PURE__ */ make("under void");
!/* @__PURE__ */ make("under !");
/* @__PURE__ */ make("an operand of &&") && log.push("the right of &&");
log.length ? /* @__PURE__ */ make("an arm of ?: in a statement") : 0;
console.log(log.join("\n"));
