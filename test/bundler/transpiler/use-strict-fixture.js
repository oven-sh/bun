"use strict";

// Test that 'use strict' makes it CommonJS when we otherwise don't know which one to pick.
// Without that, this direct eval becomes indirect, throwing a ReferenceError.
console.log(eval("typeof module.require"));
