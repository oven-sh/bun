'use strict';

require('../common');
const assert = require('assert');
const child_process = require('child_process');
const path = require('path');

process.env.BUN_DEBUG_JS = 'http';
const { stderr } = child_process.spawnSync(process.execPath, [
  path.resolve(__dirname, 'test-http-conn-reset.js'),
], { encoding: 'utf8' });

assert(stderr.match(/Setting the BUN_DEBUG_JS environment variable to 'http' can expose sensitive data \(such as passwords, tokens and authentication headers\) in the resulting log\./),
       stderr);
