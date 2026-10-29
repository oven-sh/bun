// The rows of constructor-name-fixture.cjs that need a ShadowRealm. Run as the main module, this file prints what
// the runtime prints for each row of both files, so that Node.js runs the same rows (it needs
// --experimental-shadow-realm).
const util = require("node:util");
const fixture = require("./constructor-name-fixture.cjs");

const { bare, child, data, define, reproto, tagged } = fixture.helpers;

// prettier-ignore
const shadowRealmNames = [
  ["constructor that is a function of a ShadowRealm", () => util.inspect(child(define(bare(), "constructor", data(new ShadowRealm().evaluate("(function Remote() {})"))))), "Object <[Object: null prototype] {}> {}"],
  ["function of a ShadowRealm with a tag on the prototype", () => util.inspect(reproto(new ShadowRealm().evaluate("(function f() {})"), tagged())), "[Function: f] Tag <[Object: null prototype] [Tag] {}> [Tag]"],
];

module.exports = { shadowRealmNames };

if (require.main === module) {
  console.log(JSON.stringify(fixture.printed([...fixture.constructorNames, ...shadowRealmNames])));
}
