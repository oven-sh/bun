'use strict';
const lines = [];
{
    const first = require("./other.js");
    lines.push("in the block, ahead: " + first.name);
}
const first = require("./lib.js");
lines.push("at the level of the file, behind: " + first.name);
if (lines.length > 100) {
    const never = require("./other.js");
    lines.push(never.name);
}
const never = require("./lib.js");
lines.push("behind an if that is not taken: " + never.name);
const second = require("./lib.js");
{
    const second = require("./other.js");
    lines.push("in the block, behind: " + second.name);
}
lines.push("at the level of the file, ahead: " + second.name);
function inFunction() {
    { const inner = require("./other.js"); lines.push("in a function, the block: " + inner.name); }
    const inner = require("./lib.js");
    return "in a function, its level: " + inner.name;
}
lines.push(inFunction());
function ownOfTheFunction() {
    const first = require("./other.js");
    return "a function's own, of the file's name: " + first.name;
}
lines.push(ownOfTheFunction());
function closesOver() { return "a closure sees the file's: " + first.name + " " + never.name; }
lines.push(closesOver());
{
    const { name: taken } = require("./other.js");
    lines.push("a pattern in the block: " + taken);
    lines.push((() => "a closure in the block: " + taken)());
}
const { name: taken } = require("./lib.js");
lines.push("a pattern at the level of the file: " + taken);
for (const looped of [1]) { const inLoop = require("./other.js"); lines.push("in a loop: " + inLoop.name + looped); }
const inLoop = require("./lib.js");
lines.push("behind the loop: " + inLoop.name);
switch (lines.length) { default: { const inCase = require("./other.js"); lines.push("in a clause: " + inCase.name); } }
const inCase = require("./lib.js");
lines.push("behind the switch: " + inCase.name);
console.log(lines.join("\n"));
