// Copyright (C) 2021 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-Intl.DisplayNames
description: Valid options for languageDisplay
info: |
  Intl.DisplayNames ( locales , options )

  1. If NewTarget is undefined, throw a TypeError exception.
  2. Let displayNames be ? OrdinaryCreateFromConstructor(NewTarget, "%DisplayNamesPrototype%",
    « [[InitializedDisplayNames]], [[Locale]], [[Style]], [[Type]], [[Fallback]], [[Fields]] »).
  ...
  4. Let options be ? ToObject(options).
  ...
  8. Let matcher be ? GetOption(options, "localeMatcher", "string", « "lookup", "best fit" », "best fit").
  ...
  10. Let style be ? GetOption(options, "style", "string", « "narrow", "short", "long" », "long").
  ...
  12. Let type be ? GetOption(options, "type", "string", « "language", "region", "script", "currency" », undefined).
  13. If type is undefined, throw a TypeError exception.
  ...
  24. Let languageDisplay be ? GetOption(options, "languageDisplay", "string", « "dialect", "standard" », "dialect").
  ...

  GetOption ( options, property, type, values, fallback )

  1. Let value be ? Get(options, property).
  ...
features: [Intl.DisplayNames-v2]
locale: [en]
---*/

// results for option values verified in the tests for resolvedOptions

const languageDisplays = [
  undefined,
  'dialect',
  'standard'
];

languageDisplays.forEach(languageDisplay => {
  const obj = new Intl.DisplayNames('en', { languageDisplay, type: 'language'});

  assert(obj instanceof Intl.DisplayNames, `instanceof check - ${languageDisplay}`);
  assert.sameValue(Object.getPrototypeOf(obj), Intl.DisplayNames.prototype, `proto check - ${languageDisplay}`);
});
