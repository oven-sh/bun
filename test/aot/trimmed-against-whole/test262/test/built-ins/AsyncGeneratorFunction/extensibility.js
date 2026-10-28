// Copyright (C) 2018 Valerie Young. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
esid: sec-properties-of-asyncgeneratorfunction
description: Object extensibility
info: |
  The value of the [[Extensible]] internal slot of the AsyncGeneratorFunction
  constructor is true.
features: [async-iteration]
---*/

var AsyncGeneratorFunction = Object.getPrototypeOf(async function* () {}).constructor;

assert(Object.isExtensible(AsyncGeneratorFunction));
