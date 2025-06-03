"use strict";

const { MIMEType, MIMEParams } = require("util");

// Test basic properties and string conversion
console.log("=== BASIC PROPERTIES AND STRING CONVERSION ===");
const mime1 = new MIMEType("application/ecmascript; ");
console.log(`mime1: ${mime1}`); // application/ecmascript
console.log(`JSON.stringify: ${JSON.stringify(mime1)}`); // "application/ecmascript"
console.log(`essence: ${mime1.essence}`); // application/ecmascript
console.log(`type: ${mime1.type}`); // application
console.log(`subtype: ${mime1.subtype}`); // ecmascript
console.log(`params empty: ${[...mime1.params].length === 0}`); // true
console.log(`params.has("not found"): ${mime1.params.has("not found")}`); // false
console.log(`params.get("not found"): ${mime1.params.get("not found") === null}`); // true

// Test type property manipulation
console.log("\n=== TYPE PROPERTY MANIPULATION ===");
const mime2 = new MIMEType("application/javascript");
console.log(`Original: ${mime2}`); // application/javascript
mime2.type = "text";
console.log(`After type change: ${mime2}`); // text/javascript
console.log(`essence: ${mime2.essence}`); // text/javascript

try {
  mime2.type = "";
  console.log("Should throw error for empty type but didn't");
} catch (e) {
  console.log("Error on empty type as expected");
}

try {
  mime2.type = ",";
  console.log("Should throw error for invalid type but didn't");
} catch (e) {
  console.log("Error on invalid type as expected");
}

// Test subtype property manipulation
console.log("\n=== SUBTYPE PROPERTY MANIPULATION ===");
const mime3 = new MIMEType("text/plain");
console.log(`Original: ${mime3}`); // text/plain
mime3.subtype = "javascript";
console.log(`After subtype change: ${mime3}`); // text/javascript

try {
  mime3.subtype = "";
  console.log("Should throw error for empty subtype but didn't");
} catch (e) {
  console.log("Error on empty subtype as expected");
}

try {
  mime3.subtype = ",";
  console.log("Should throw error for invalid subtype but didn't");
} catch (e) {
  console.log("Error on invalid subtype as expected");
}

// Test parameters manipulation
console.log("\n=== PARAMETERS MANIPULATION ===");
const mime4 = new MIMEType("text/javascript");
const params = mime4.params;

// Setting parameters
params.set("charset", "utf-8");
console.log(`params.has("charset"): ${params.has("charset")}`); // true
console.log(`params.get("charset"): ${params.get("charset")}`); // utf-8
console.log(`params entries length: ${[...params].length}`); // 1
console.log(`mime with charset: ${mime4}`); // text/javascript;charset=utf-8

// Multiple parameters
params.set("goal", "module");
console.log(`params.has("goal"): ${params.has("goal")}`); // true
console.log(`params.get("goal"): ${params.get("goal")}`); // module
console.log(`params entries length: ${[...params].length}`); // 2
console.log(`mime with multiple params: ${mime4}`); // text/javascript;charset=utf-8;goal=module

// Updating a parameter
params.set("charset", "iso-8859-1");
console.log(`updated charset: ${params.get("charset")}`); // iso-8859-1
console.log(`mime with updated charset: ${mime4}`); // text/javascript;charset=iso-8859-1;goal=module

// Deleting a parameter
params.delete("charset");
console.log(`params.has("charset") after delete: ${params.has("charset")}`); // false
console.log(`params.get("charset") after delete: ${params.get("charset") === null}`); // true
console.log(`params entries length after delete: ${[...params].length}`); // 1
console.log(`mime after param delete: ${mime4}`); // text/javascript;goal=module

// Empty parameter value
params.set("x", "");
console.log(`params.has("x"): ${params.has("x")}`); // true
console.log(`params.get("x"): ${params.get("x") === "" ? "empty string" : params.get("x")}`); // empty string
console.log(`mime with empty param: ${mime4}`); // text/javascript;goal=module;x=""

// Test parameter case sensitivity
console.log("\n=== PARAMETER CASE SENSITIVITY ===");
const mime5 = new MIMEType("text/javascript;CHARSET=UTF-8;abc=;def;ghi");
console.log(`mime5: ${mime5}`); // text/javascript;charset=UTF-8
console.log(`mime5.params.get("CHARSET"): ${mime5.params.get("CHARSET") === null}`); // true (null)
console.log(`mime5.params.get("charset"): ${mime5.params.get("charset")}`); // UTF-8
console.log(`mime5.params.has("CHARSET"): ${mime5.params.has("CHARSET")}`); // false
console.log(`mime5.params.has("charset"): ${mime5.params.has("charset")}`); // true
console.log(`mime5.params.has("abc"): ${mime5.params.has("abc")}`); // false (invalid param)
console.log(`mime5.params.has("def"): ${mime5.params.has("def")}`); // false (invalid param)

mime5.params.set("CHARSET", "UTF-8");
console.log(`mime5.params.get("CHARSET") after set: ${mime5.params.get("CHARSET")}`); // UTF-8
console.log(`mime5.params.has("CHARSET") after set: ${mime5.params.has("CHARSET")}`); // true

// Test quoted parameter values
console.log("\n=== QUOTED PARAMETER VALUES ===");
const mime6 = new MIMEType('text/plain;charset="utf-8"');
console.log(`mime6: ${mime6}`); // text/plain;charset=utf-8
console.log(`mime6.params.get("charset"): ${mime6.params.get("charset")}`); // utf-8

// Setting parameter that requires quoting
params.set("filename", "file with spaces.txt");
console.log(`mime with filename: ${mime4}`); // Should have quotes around the value

// Test invalid parameters
console.log("\n=== INVALID PARAMETERS ===");
try {
  params.set("", "x");
  console.log("Should throw error for empty param name but didn't");
} catch (e) {
  console.log("Error on empty param name as expected");
}

try {
  params.set("x=", "x");
  console.log("Should throw error for invalid param name but didn't");
} catch (e) {
  console.log("Error on invalid param name as expected");
}

try {
  params.set("x", "\n");
  console.log("Should throw error for invalid param value but didn't");
} catch (e) {
  console.log("Error on invalid param value as expected");
}

// Test params iteration
console.log("\n=== PARAMS ITERATION ===");
const mime7 = new MIMEType("text/plain;charset=utf-8;format=flowed");
console.log("Iterating params.entries():");
for (const [key, value] of mime7.params.entries()) {
  console.log(`  ${key}: ${value}`);
}

console.log("Iterating params.keys():");
for (const key of mime7.params.keys()) {
  console.log(`  ${key}`);
}

console.log("Iterating params.values():");
for (const value of mime7.params.values()) {
  console.log(`  ${value}`);
}

console.log("Iterating params directly:");
for (const entry of mime7.params) {
  console.log(`  ${entry[0]}: ${entry[1]}`);
}

// Test parsing edge cases
console.log("\n=== PARSING EDGE CASES ===");
const mime8 = new MIMEType("text/plain; charset=utf-8; goal=module; empty=");
console.log(`mime8: ${mime8}`); // text/plain;charset=utf-8;goal=module
console.log(`Has empty param: ${mime8.params.has("empty")}`); // false (invalid parameter)

const mime9 = new MIMEType('text/plain; charset="utf\\-8"');
console.log(`mime9: ${mime9}`); // text/plain;charset="utf-8"
console.log(`mime9 charset: ${mime9.params.get("charset")}`); // utf-8

// Test toString() and toJSON()
console.log("\n=== TO STRING AND TO JSON ===");
const mime10 = new MIMEType("text/plain;charset=utf-8");
console.log(`toString(): ${mime10.toString()}`); // text/plain;charset=utf-8
console.log(`toJSON(): ${mime10.toJSON()}`); // text/plain;charset=utf-8

console.log(`params toString(): ${mime10.params.toString()}`); // charset=utf-8
console.log(`params toJSON(): ${mime10.params.toJSON()}`); // charset=utf-8

// Basic MIMEParams tests
console.log("=== BASIC MIMEPARAMS OPERATIONS ===");
const params2 = new MIMEParams();
console.log(`New params empty: ${[...params2].length === 0}`); // true

// Set and get operations
params2.set("charset", "utf-8");
console.log(`params.has("charset"): ${params2.has("charset")}`); // true
console.log(`params.get("charset"): ${params2.get("charset")}`); // utf-8
console.log(`params entries length: ${[...params2].length}`); // 1
console.log(`params toString(): ${params2.toString()}`); // charset=utf-8

// Case sensitivity
console.log(`\n=== CASE SENSITIVITY ===`);
console.log(`params.has("CHARSET"): ${params2.has("CHARSET")}`); // false
console.log(`params.get("CHARSET"): ${params2.get("CHARSET") === null}`); // true
params2.set("CHARSET", "iso-8859-1");
console.log(`After setting CHARSET, params.has("CHARSET"): ${params2.has("CHARSET")}`); // true
console.log(`After setting CHARSET, params.get("CHARSET"): ${params2.get("CHARSET")}`); // iso-8859-1
console.log(`params.has("charset"): ${params2.has("charset")}`); // true, original still exists
console.log(`params.get("charset"): ${params2.get("charset")}`); // utf-8
console.log(`params entries length: ${[...params2].length}`); // 2
console.log(`params toString(): ${params2.toString()}`); // charset=utf-8;CHARSET=iso-8859-1

// Delete operation
console.log(`\n=== DELETE OPERATION ===`);
params2.delete("charset");
console.log(`After delete, params.has("charset"): ${params2.has("charset")}`); // false
console.log(`After delete, params.get("charset"): ${params2.get("charset") === null}`); // true
console.log(`params.has("CHARSET"): ${params2.has("CHARSET")}`); // true, other case still exists
console.log(`params entries length: ${[...params2].length}`); // 1
console.log(`params toString(): ${params2.toString()}`); // CHARSET=iso-8859-1

// Multiple parameters
console.log(`\n=== MULTIPLE PARAMETERS ===`);
params2.set("format", "flowed");
params2.set("delsp", "yes");
console.log(`params entries length: ${[...params2].length}`); // 3
console.log(`params toString(): ${params2.toString()}`); // CHARSET=iso-8859-1;format=flowed;delsp=yes

// Parameter values requiring quoting
console.log(`\n=== QUOTED VALUES ===`);
params2.set("filename", "file with spaces.txt");
console.log(`params.get("filename"): ${params2.get("filename")}`); // file with spaces.txt
console.log(`params toString(): ${params2.toString()}`); // should contain quoted filename

// Empty parameter values
console.log(`\n=== EMPTY VALUES ===`);
params2.set("empty", "");
console.log(`params.has("empty"): ${params2.has("empty")}`); // true
console.log(`params.get("empty"): ${params2.get("empty") === "" ? "empty string" : params2.get("empty")}`); // empty string
console.log(`params toString() with empty value: ${params2.toString()}`); // includes empty=""

// Characters requiring escaping in quoted strings
console.log(`\n=== ESCAPE SEQUENCES IN QUOTED VALUES ===`);
params2.set("path", "C:\\Program Files\\App");
console.log(`params.get("path"): ${params2.get("path")}`); // C:\Program Files\App
console.log(`params toString() with backslashes: ${params2.toString()}`); // should escape backslashes

// Special characters
console.log(`\n=== SPECIAL CHARACTERS ===`);
params2.set("test", "!#$%&'*+-.^_`|~");
console.log(`params.get("test"): ${params2.get("test")}`); // !#$%&'*+-.^_`|~
console.log(`params toString() with special chars: ${params2.toString()}`); // should not quote these

// Error cases
console.log(`\n=== ERROR CASES ===`);
try {
  params2.set("", "value");
  console.log("Should throw error for empty name but didn't");
} catch (e) {
  console.log(`Empty name error: ${e.name}`);
}

try {
  params2.set("invalid name", "value");
  console.log("Should throw error for invalid name but didn't");
} catch (e) {
  console.log(`Invalid name error: ${e.name}`);
}

try {
  params2.set("name", "\0");
  console.log("Should throw error for invalid value but didn't");
} catch (e) {
  console.log(`Invalid value error: ${e.name}`);
}

// Iteration methods
console.log(`\n=== ITERATION METHODS ===`);
console.log(`Keys:`);
for (const key of params2.keys()) {
  console.log(`  ${key}`);
}

console.log(`Values:`);
for (const value of params2.values()) {
  console.log(`  ${value}`);
}

console.log(`Entries:`);
for (const [key, value] of params2.entries()) {
  console.log(`  ${key}: ${value}`);
}

console.log(`Direct iteration:`);
for (const [key, value] of params2) {
  console.log(`  ${key}: ${value}`);
}

// toJSON method
console.log(`\n=== JSON SERIALIZATION ===`);
console.log(`params.toJSON(): ${params2.toJSON()}`);
console.log(`JSON.stringify(params): ${JSON.stringify(params2)}`);

// Clone and modify test
console.log(`\n=== CLONE AND MODIFY ===`);
const original = new MIMEParams();
original.set("charset", "utf-8");
original.set("boundary", "boundary");

const clone = new MIMEParams();
for (const [key, value] of original) {
  clone.set(key, value);
}
clone.set("charset", "iso-8859-1");

console.log(`Original params: ${original.toString()}`);
console.log(`Cloned params: ${clone.toString()}`);
