'use strict';

const common = require('../common');

const timer = require('node:timers');
const timerPromises = require('node:timers/promises');
const assert = require('assert');

assert.deepStrictEqual(timerPromises, timer.promises);
