'use strict';

// Issue: https://github.com/nodejs/node/issues/3655
// Test checks if we get exception instead of runtime error

const common = require('../common');
if (!common.hasCrypto)
  common.skip('missing crypto');

const assert = require('assert');

const TlsSocket = require('tls').TLSSocket;
const EventEmitter = require('events').EventEmitter;

console.log('Creating new EventEmitter...');
const emitter = new EventEmitter();
console.log('EventEmitter created');

console.log('Attempting to create new TLSSocket with EventEmitter...');
assert.throws(
  () => { 
    console.log('Inside throws callback');
    new TlsSocket(emitter);
    console.log('TLSSocket created (this should not happen)');
  },
  TypeError
);
console.log('Successfully caught TypeError as expected');
