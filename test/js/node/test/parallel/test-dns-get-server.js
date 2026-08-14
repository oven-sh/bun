'use strict';
const common = require('../common');
const assert = require('assert');

const { Resolver } = require('dns');

const resolver = new Resolver();
// Android's platform resolver exposes no server list; [] is expected there.
assert(resolver.getServers().length > 0 || process.platform === 'android');
// return undefined
resolver._handle.getServers = common.mustCall();
assert.strictEqual(resolver.getServers().length, 0);
