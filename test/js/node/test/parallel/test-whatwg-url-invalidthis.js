'use strict';

require('../common');

const { URL } = require('url');
const assert = require('assert');

[
  'toString',
  'toJSON',
].forEach((i) => {
  assert.throws(() => Reflect.apply(URL.prototype[i], [], {}), {
    name: 'TypeError',
    message: /Can only call URL\.[a-zA-Z]+ on instances of URL/
  });
});

[
  'href',
  'search',
].forEach((i) => {
  assert.throws(() => Reflect.get(URL.prototype, i, {}), {
    name: 'TypeError',
    message: /can only be used on instances of URL/
  });

  assert.throws(() => Reflect.set(URL.prototype, i, null, {}), {
    name: 'TypeError',
    message: /can only be used on instances of URL/,
  });
});

[
  'protocol',
  'username',
  'password',
  'host',
  'hostname',
  'port',
  'pathname',
  'hash',
].forEach((i) => {
  assert.throws(() => Reflect.get(URL.prototype, i, {}), {
    name: 'TypeError',
    message: /can only be used on instances of URL/,
  });

  assert.throws(() => Reflect.set(URL.prototype, i, null, {}), {
    name: 'TypeError',
    message: /can only be used on instances of URL/,
  });
});

[
  'origin',
  'searchParams',
].forEach((i) => {
  assert.throws(() => Reflect.get(URL.prototype, i, {}), {
    name: 'TypeError',
    message: /can only be used on instances of URL/,
  });
});
