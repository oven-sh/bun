// Copyright (C) 2023 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-json.parse
description: >
  Context argument and its source property behave as expected when parsing a
  NumericLiteral, NullLiteral, BoolLiteral, or StringLiteral JSON string
includes: [compareArray.js, propertyHelper.js]
features: [json-parse-with-source]
---*/

function assertOnlyOwnProperties(object, props, message) {
  assert.compareArray(Object.getOwnPropertyNames(object), props, `${message}: object should have no other properties than expected`);
  assert.compareArray(Object.getOwnPropertySymbols(object), [], `${message}: object should have no own symbol properties`);
}

function reviverWithExpectedSources(expectedSources) {
  let i = 0;
  return function reviver(key, value, context) {
    assert.sameValue(typeof context, "object", "context should be an object");
    assert.sameValue(Object.getPrototypeOf(context), Object.prototype, "context should be a plain object");
    if (expectedSources[i] !== undefined) {
      assertOnlyOwnProperties(context, ["source"],
        "the JSON value is a primitve value, its context should only have a source property");
      verifyProperty(context, "source", {
        value: expectedSources[i++],
        configurable: true,
        enumerable: true,
        writable: true,
      }, { restore: true });
    } else {
      assertOnlyOwnProperties(context, [],
        "the JSON value is an Array or Object, its context should have no property");
      i++;
    }
    return value;
  };
}

assert.sameValue(1, JSON.parse('1', reviverWithExpectedSources(['1'])));
assert.sameValue(1.1, JSON.parse('1.1', reviverWithExpectedSources(['1.1'])));
assert.sameValue(-1, JSON.parse('-1', reviverWithExpectedSources(['-1'])));
assert.sameValue(
  -1.1,
  JSON.parse('-1.1', reviverWithExpectedSources(['-1.1']))
);
assert.sameValue(
  11,
  JSON.parse('1.1e1', reviverWithExpectedSources(['1.1e1']))
);
assert.sameValue(
  11,
  JSON.parse('1.1e+1', reviverWithExpectedSources(['1.1e+1']))
);
assert.sameValue(
  0.11,
  JSON.parse('1.1e-1', reviverWithExpectedSources(['1.1e-1']))
);
assert.sameValue(
  11,
  JSON.parse('1.1E1', reviverWithExpectedSources(['1.1E1']))
);
assert.sameValue(
  11,
  JSON.parse('1.1E+1', reviverWithExpectedSources(['1.1E+1']))
);
assert.sameValue(
  0.11,
  JSON.parse('1.1E-1', reviverWithExpectedSources(['1.1E-1']))
);

// Test NullLiteral, BoolLiteral, StringLiteral
assert.sameValue(
  JSON.parse('null', reviverWithExpectedSources(['null'])),
  null
);
assert.sameValue(
  JSON.parse('true', reviverWithExpectedSources(['true'])),
  true
);
assert.sameValue(
  JSON.parse('false', reviverWithExpectedSources(['false'])),
  false
);
assert.sameValue(
  JSON.parse('"foo"', reviverWithExpectedSources(['"foo"'])),
  "foo"
);
