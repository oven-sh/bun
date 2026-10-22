// Objects that still have the shape their literal gave them are stored to by name, under names that are there, and what may not be stored to like that.
function point(i) { return { x: i, y: i + 1, z: i + 2 }; }
function pair(i) { return { first: i, second: "s" + i }; }
function wide(i) { return { a: i, b: i, c: i, d: i, e: i, f: i, g: i, h: i, i: i, j: i }; }
function movePoint(o, turns) { for (let i = 0; i < turns; i++) { o.x = i; o.y = i + 1; o.z = o.x + o.y; } return o; }
function swapPair(o, turns) { for (let i = 0; i < turns; i++) { const first = o.first; o.first = o.second; o.second = first; } return o; }
function fillWide(o, turns) { for (let i = 0; i < turns; i++) { o.a = i; o.e = "e" + i; o.j = { i }; } return o; }
console.log(JSON.stringify(movePoint(point(1), 100)), JSON.stringify(swapPair(pair(2), 101)), JSON.stringify(fillWide(wide(3), 100)));

// What may not be stored to like that.
"use strict";
function setX(o, turns, value) { let failed = 0; for (let i = 0; i < turns; i++) { try { o.x = value; } catch (error) { failed++; } } return [o.x, failed].join(); }
console.log(setX(point(1), 50, "stored"));
console.log(setX(Object.freeze(point(2)), 50, "stored"));
console.log(setX(Object.seal(point(3)), 50, "stored"));
console.log(setX(Object.preventExtensions(point(4)), 50, "stored"));
console.log(setX(Object.defineProperty(point(5), "x", { writable: false }), 50, "stored"));
let seen = 0;
console.log(setX(Object.defineProperty(point(6), "x", { get() { return "got"; }, set(v) { seen++; } }), 50, "stored"), seen);
const shrunk = point(7); delete shrunk.x;
console.log(setX(shrunk, 50, "stored again"), Object.keys(shrunk).join());
const parent = point(8);
const child = Object.create(parent);
console.log(setX(parent, 50, "on the parent"), child.x, setX(child, 50, "on the child"), parent.x, Object.keys(child).join());
console.log(setX(point(9), 50, "stored"), JSON.stringify(movePoint(point(10), 3)));
function Made(i) { this.x = i; this.other = i; }
class Built { constructor(i) { this.x = i; this.other = i; } }
console.log(setX(new Made(1), 50, "made"), setX(new Built(1), 50, "built"));
Object.defineProperty(Made.prototype, "x", { set(v) { seen += 100; }, configurable: true });
console.log(setX(new Made(2), 50, "made"), seen, Object.keys(new Made(3)).join());
