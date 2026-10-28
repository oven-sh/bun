// Names are asked of a value that is a proxy in some turns and a function of the program in others. The build verifies the program behind every pass.
function named() {}
function asks(thing) {
  return ["alpha" in thing, "name" in thing, thing.alpha, thing.prototype === named.prototype].join();
}
const things = [new Proxy({ alpha: 1 }, {}), named, new Proxy(named, {}), new Proxy(named, { has: () => true })];
for (let round = 0; round < 3; round++) for (const thing of things) console.log(asks(thing));
