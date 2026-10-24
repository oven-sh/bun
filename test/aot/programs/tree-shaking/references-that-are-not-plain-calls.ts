// One function per way of naming it without writing a plain call of it.
const log: unknown[] = [];
function shorthand() { return "shorthand"; } function tagged(s: TemplateStringsArray) { return "tagged " + s[0]; } function optional() { return "optional call"; }
function Constructed(this: any) { this.value = "constructed"; } function ConstructedBare(this: any) { this.value = "constructed without parentheses"; }
function underTypeof() {} function inTemplate() { return 1; } function spreadIn() { return "spread"; } function inArray() { return "array"; }
function viaBind() { return "bind"; } function viaApply() { return "apply"; } function inCondition() { return "condition"; } function afterComma() { return "comma"; }
function rightOfInstanceof() {} function awaited() { return "awaited"; } function inNullish() { return "nullish"; } function thrown() { return "thrown"; }
function asKey() { return "key"; } function inSwitch() { return "switch"; } function inReturn() { return "return"; } function inIn() {}
function* delegated() { yield "delegated"; } function nonNull() { return "non-null"; } function cast() { return "cast"; } function angle() { return "angle cast"; }
function satisfied() { return "satisfies"; } function generic<T>(value: T) { return value; } function parenthesized() { return "parenthesized"; }

log.push({ shorthand }.shorthand(), tagged`x`, optional?.(), new (Constructed as any)().value, (new (ConstructedBare as any)).value);
log.push(typeof underTypeof, `${inTemplate}`.length > 0, [...[spreadIn]][0](), [inArray][0]());
log.push(viaBind.bind(null)(), viaApply.apply(null), (log.length ? inCondition : undefined)!(), (log.length, afterComma)());
log.push({} instanceof rightOfInstanceof, (await awaited)(), (([] as (() => string)[])[0] ?? inNullish)());
try { throw thrown; } catch (caught: any) { log.push(caught()); }
log.push(Object.keys({ [asKey()]: 1 })[0]);
switch (inSwitch) { case inSwitch: log.push(inSwitch()); }
log.push((() => { return inReturn; })()(), "name" in inIn);
log.push([...(function* () { yield* delegated(); })()][0]);
log.push(nonNull!(), (cast as () => string)(), (<() => string>angle)(), (satisfied satisfies () => string)(), (parenthesized)());
const instantiated = generic<string>;
log.push(instantiated("instantiation expression"), generic<string>("type arguments"));
console.log(log.join("\n"));
