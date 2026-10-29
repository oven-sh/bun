"use strict";
const { parentPort } = require("node:worker_threads");
const util = require("node:util");
parentPort.postMessage(util.inspect(JSON.parse('{"a":1,"b":{"c":[1,2,3]}}')));
