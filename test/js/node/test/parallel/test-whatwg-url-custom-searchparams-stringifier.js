'use strict';

// Tests below are not from WPT.

require('../common');
const assert = require('assert');

{
  const params = new URLSearchParams();
  assert.throws(() => {
    params.toString.call(undefined);
  }, {
    code: 'ERR_INVALID_THIS',
    name: 'TypeError',
    message: 'Can only call URLSearchParams.toString on instances of URLSearchParams',
  });
}

// The URLSearchParams stringifier mutates the base URL using
// different percent-encoding rules than the URL itself.
{
  const myUrl = new URL('https://example.org?foo=~bar');
  assert.strictEqual(myUrl.search, '?foo=~bar');
  myUrl.searchParams.sort();
  assert.strictEqual(myUrl.search, '?foo=%7Ebar');
}
