function plain() { return 1; }
class WithConstructor { constructor() { this.x = 2; } method() { return 3; } }
class WithoutConstructor { }
function* generator() { yield 4; }
const arrow = () => 5;

for (const f of [plain, WithConstructor, WithConstructor.prototype.method, WithoutConstructor, generator, arrow]) {
    noInline(f);
    neverInlineFunction(f);
    noDFG(f);
    noFTL(f);
    noOSRExitFuzzing(f);
}
if (plain() + new WithConstructor().x + new WithConstructor().method() + generator().next().value + arrow() !== 15 || !(new WithoutConstructor() instanceof WithoutConstructor))
    throw new Error("bad result");
console.log("passed");
