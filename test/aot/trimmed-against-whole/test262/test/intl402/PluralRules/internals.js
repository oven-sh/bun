// Copyright 2016 Mozilla Corporation. All rights reserved.
// This code is governed by the license found in the LICENSE file.

/*---
esid: sec-intl-pluralrules-constructor
description: >
    Tests that objects constructed by Intl.PluralRules have the specified
    internal properties.
author: Zibi Braniecki
---*/

var obj = new Intl.PluralRules();

var actualPrototype = Object.getPrototypeOf(obj);
assert.sameValue(actualPrototype, Intl.PluralRules.prototype, "Prototype of object constructed by Intl.PluralRules isn't Intl.PluralRules.prototype; got " + actualPrototype);

assert(Object.isExtensible(obj), "Object constructed by Intl.PluralRules must be extensible.");
