//#FILE: test-net-autoselectfamily-attempt-timeout-default-value.js
//#SHA1: 028b16515c47d987e68ca138e753ed4d255f179c
//-----------------
"use strict";

const { platformTimeout } = require("../common");
const { getDefaultAutoSelectFamilyAttemptTimeout } = require("net");

test("getDefaultAutoSelectFamilyAttemptTimeout returns the correct default value", () => {
  expect(getDefaultAutoSelectFamilyAttemptTimeout()).toBe(platformTimeout(2500));
});

//<#END_FILE: test-net-autoselectfamily-attempt-timeout-default-value.js
