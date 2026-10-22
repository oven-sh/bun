// Code that stands in or beside something a compiler removes, and still runs: the body of do-while(false), the initializer of for(;false;), the else of if(false), a case that is fallen into, catch and finally, the operand of void, a comma, a label that is left.
const log: string[] = [];
function inDo() { log.push("do"); } function inForInit() { log.push("for init"); } function inElse() { log.push("else"); }
function inFallThrough() { log.push("fall through"); } function inDefault() { log.push("default"); } function inCatch() { log.push("catch"); }
function inFinally() { log.push("finally"); } function underVoid() { log.push("void"); } function beforeComma() { log.push("comma"); }
function beforeBreak() { log.push("before break"); } function afterLabel() { log.push("after label"); } function inCondition() { log.push("condition"); return false; }
function inFinallyAfterReturn() { log.push("finally after return"); } function inUnusedTemplate() { log.push("template"); return ""; }
function asUnusedArgument() { log.push("argument"); } function inUnusedArray() { log.push("array"); } function inUnusedObject() { log.push("object"); return "k"; }

do inDo(); while (false);
for (inForInit(); false; );
if (false) {
} else inElse();
switch (1 as number) {
  case 1:
  case 2:
    inFallThrough();
  default:
    inDefault();
}
try {
  throw 1;
} catch {
  inCatch();
} finally {
  inFinally();
}
void underVoid();
beforeComma(), 0;
label: {
  beforeBreak();
  break label;
}
afterLabel();
if (inCondition()) {
}
(() => {
  try {
    return;
  } finally {
    inFinallyAfterReturn();
  }
})();
`${inUnusedTemplate()}`;
((...ignored: unknown[]) => {})(asUnusedArgument());
[inUnusedArray()];
({ [inUnusedObject()]: 1 });
console.log(log.join(", "));
