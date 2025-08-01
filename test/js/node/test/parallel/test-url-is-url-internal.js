/*
 * NOTE (@DonIsaac) this file tests node internals, which Bun does not match.
 * We aim for API compatability, but make no guarantees about internals.
 */

// // Flags: --expose-internals
// 'use strict';

// require('../common');

// const { URL, parse } = require('node:url');
// const assert = require('node:assert');
// const { isURL } = require('internal/url');
// const { test } = require('node:test');

// test('isURL', () => {
//   assert.strictEqual(isURL(new URL('https://www.nodejs.org')), true);
//   assert.strictEqual(isURL(parse('https://www.nodejs.org')), false);
//   assert.strictEqual(isURL({
//     href: 'https://www.nodejs.org',
//     protocol: 'https:',
//     path: '/',
//   }), false);
// });
