// Bindings that hold a function and are stored to: a let, a var, a function declaration, each by a plain store, a pattern, a for-of head, and a logical assignment. What the binding holds at the time of the call is what runs.
const log: string[] = [];

let viaLet = function () { return "let: first"; };
log.push(viaLet());
viaLet = function () { return "let: second"; };
log.push(viaLet());

function declared() { return "declaration: first"; }
function replacement() { return "declaration: second"; }
log.push(declared());
(declared as any) = replacement;
log.push(declared());

let viaPattern = () => "pattern: first";
function fromPattern() { return "pattern: second"; }
log.push(viaPattern());
[viaPattern] = [fromPattern];
log.push(viaPattern());
function fromObjectPattern() { return "pattern: third"; }
({ viaPattern } = { viaPattern: fromObjectPattern });
log.push(viaPattern());

let viaLoop = () => "loop: first";
function fromLoop() { return "loop: second"; }
log.push(viaLoop());
for (viaLoop of [fromLoop]);
log.push(viaLoop());

let viaLogical: (() => string) | undefined;
function fromLogical() { return "logical: first"; }
function notTaken() { return "logical: never"; }
viaLogical ??= fromLogical;
viaLogical ||= notTaken;
log.push(viaLogical());

console.log(log.join("\n"));
