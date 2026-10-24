const long = "a[_-]?b. bull ".repeat(3000);
const wide = "中文 a.b bull [_-]? ".repeat(600);
console.log(long.replace(/\[_-\]\?/g, "").length, long.replace(/\[_-\]\?/, "<>").indexOf("<>"), long.split(/\./).length, long.split(/bull/, 7).length);
console.log(wide.replace(/\[_-\]\?/g, "").length, wide.split(/中文/).length, wide.search(/文 a/), wide.match(/bull/g)!.length, wide.match(/bull/)!.index);
console.log(/bull/.test("a bull"), /bull/.test("a bul"), /bull/.test(""), /bull/.exec("a bull in a bull pen")!.index, "no".search(/bull/), "bull".search(/bull/));
const every = /bull/g;
const places: number[] = [];
for (let match = every.exec("bull bull, bullbull"); match; match = every.exec("bull bull, bullbull")) places.push(match.index, every.lastIndex);
console.log(places.join(), every.lastIndex, RegExp.lastMatch, RegExp.leftContext.length, RegExp.rightContext.length);
console.log("a.b.c".replace(/\./g, match => `<${match}>`), "a.b.c".replace(/\./g, "$&$&"), "a.b.c".replace(/\./, "$`|$'"), "x".replace(/\./g, "-"), [..."a.b.c".matchAll(/\./g)].map(match => match.index).join());
const built = new RegExp("b\\. " + (Date.now() < 0 ? "x" : "bull"), "g");
console.log(long.match(built)!.length, long.replace(built, "").length, built.source, built.flags);

console.log(/bul+/.test(long), /BULL/i.test(long), /^a\[/.test(long), /bull|cow/.exec(long)!.index, long.replace(/\[_-\]\?$/gm, "").length);
