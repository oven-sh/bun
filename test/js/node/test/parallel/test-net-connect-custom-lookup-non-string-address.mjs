import * as common from '../common/index.mjs';
import net from 'node:net';
import { describe, it } from 'node:test';

const brokenCustomLookup = (_hostname, options, callback) => {
  // Incorrectly return an array of IPs instead of a string.
  callback(null, ['127.0.0.1'], options.family);
};

describe('when family is ipv4', () => {
  it('socket emits an error when lookup does not return a string', (t, done) => {
    const options = {
      host: 'example.com',
      port: 80,
      lookup: brokenCustomLookup,
      family: 4
    };
    expect(() => net.connect(options, common.mustNotCall())).toThrow('hostname must be a string');
  });
});

describe('when family is ipv6', () => {
  it('socket emits an error when lookup does not return a string', (t, done) => {
    const options = {
      host: 'example.com',
      port: 80,
      lookup: brokenCustomLookup,
      family: 6
    };
    expect(() => net.connect(options, common.mustNotCall())).toThrow('hostname must be a string');
  });
});
