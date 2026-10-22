// Statements that compute something and drop it. Reading a member can run a getter or a trap, naming a variable can throw, an operator can convert an object, and a function that is called on the spot runs. `bun run` and `bun build --compile` print the same.
const log = [];
function effect(name) { log.push(name); return name; }
const source = { get getter() { return effect("a getter"); }, plain: 1 };
const trapped = new Proxy({}, { get(target, key) { return effect("a get trap for " + String(key)); } });
const converts = { valueOf() { effect("valueOf"); return 1; }, toString() { effect("toString"); return "s"; } };

source.getter;
source.plain;
source["getter"];
source?.getter;
trapped.anything;
trapped[effect("a computed key")];
+converts;
`${converts}`;
converts + 1;
converts == 1;
converts < 2;
-converts;
!converts;
typeof converts;
void effect("the operand of void");
(() => effect("a function called on the spot"))();
(function () { effect("an old-style one"); })();
new (class { constructor() { effect("a constructor"); } })();
[effect("an element")];
({ key: effect("a value") });
effect("the left of a comma"), 1;
true && effect("the right of &&");
false || effect("the right of ||");
null ?? effect("the right of ??");
try {
  notDeclaredAnywhere;
} catch (error) {
  log.push(error.name + " for a name that is not declared");
}
typeof notDeclaredAnywhere;
try {
  null.member;
} catch (error) {
  log.push(error.name + " for a member of null");
}
1;
"text";
source;

console.log(log.join("\n"));
