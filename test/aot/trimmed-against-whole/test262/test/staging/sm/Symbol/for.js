/*
 * Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/licenses/publicdomain/
 */

/*---
description: |
  pending
esid: pending
---*/
// Symbol.for called twice with the same argument returns the same symbol.
assert.sameValue(Symbol.for("ponies"), Symbol.for("ponies"));

// Called twice with equal strings: still the same result.
var one = Array(64+1).join("x");
var two = Array(8+1).join(Array(8+1).join("x"));
assert.sameValue(Symbol.for(one), Symbol.for(two));

// Symbols created by calling Symbol() are not in the symbol registry.
var sym = Symbol("123");
assert.sameValue(Symbol.for("123") !== sym, true);

// Empty string is fine.
assert.sameValue(typeof Symbol.for(""), "symbol");

// Primitive arguments.
assert.sameValue(Symbol.for(3), Symbol.for("3"));
assert.sameValue(Symbol.for(null), Symbol.for("null"));
assert.sameValue(Symbol.for(undefined), Symbol.for("undefined"));
assert.sameValue(Symbol.for(), Symbol.for("undefined"));

// Symbol.for ignores the 'this' value.
var foo = Symbol.for("foo")
assert.sameValue(Symbol.for.call(String, "foo"), foo);
assert.sameValue(Symbol.for.call(3.14, "foo"), foo);

