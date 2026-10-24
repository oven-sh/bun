// Each variable has a plain initializer and nothing ever reads it, but something stores to it, each in another way. The right-hand sides have effects, so the stores stay and need a variable to store to.
const log = [];
function effect(name) { log.push(name); return name; }

let plain = 1;
plain = effect("a plain store");
let compound = 1;
compound += effect("a compound store").length;
let logical = null;
logical ??= effect("a logical store");
let counted = 1;
counted++;
--counted;
let inArray = 1;
[inArray] = [effect("an array pattern")];
let inObject = 1;
({ inObject } = { inObject: effect("an object pattern") });
let renamed = 1;
({ key: renamed } = { key: effect("a renamed property") });
let withDefault = 1;
({ withDefault = effect("a default in a pattern") } = {});
let restOfArray = 1;
[...restOfArray] = [effect("a rest element")];
let restOfObject = 1;
({ ...restOfObject } = { a: effect("a rest property") });
let nested = 1;
[{ deep: [nested] }] = [{ deep: [effect("a nested pattern")] }];
let inForOf = 1;
for (inForOf of [effect("a for-of head")]);
let inForIn = 1;
for (inForIn in { [effect("a for-in head")]: 1 });
let inForOfPattern = 1;
for ([inForOfPattern] of [[effect("a pattern in a for-of head")]]);
var viaVar = 1;
viaVar = effect("a store to a var");
let inFunction = 1;
function stores() { inFunction = effect("a store inside a function"); }
stores();
let inArrow = 1;
(() => (inArrow = effect("a store inside an arrow function")))();
let inClass = 1;
class Storer { static { inClass = effect("a store inside a static block"); } }
let chained = 1, alsoChained = 1;
chained = alsoChained = effect("a chained store");

console.log(log.join("\n"));
