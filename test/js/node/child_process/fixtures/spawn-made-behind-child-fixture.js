// Prints what the first spawn() of a process has made when its child starts, and what it makes
// once the child has started:
//   madeAhead: for each stream of child.stdio, whether it existed when the native Bun.spawn() was called
//   madeBehind.streams: the streams that spawn() constructed behind the return of the native Bun.spawn()
//   madeBehind.functions: the functions that came to exist there (a built-in module that loads makes hundreds)
//   own: the own stdio properties of the ChildProcess at the return of spawn()
// usage: <stdio, as JSON>, as the main script or as the script of a Worker
const { heapStats } = require("bun:jsc");

// A stream constructor stores its state under one of these names, and the setters see it. A
// constructor that stores its state in another way is not seen: its stream reads as not made ahead.
const constructed = new Set();
const stateNames = ["_readableState", "_writableState"];
for (const name of stateNames) {
  Object.defineProperty(Object.prototype, name, {
    configurable: true,
    set(value) {
      constructed.add(this);
      Object.defineProperty(this, name, { value, writable: true, configurable: true, enumerable: true });
    },
  });
}

const { spawn } = require("node:child_process");

const stdio = JSON.parse(process.argv[2]);
const functions = () => heapStats().objectTypeCounts.FunctionExecutable ?? 0;

const nativeSpawn = Bun.spawn;
let ahead, started;
Bun.spawn = function (options) {
  ahead = new Set(constructed);
  const subprocess = nativeSpawn.call(this, options);
  started = { streams: constructed.size, functions: functions() };
  return subprocess;
};

const child = spawn(process.execPath, ["--version"], { stdio });
const madeBehind = { streams: constructed.size - started.streams, functions: functions() - started.functions };
for (const name of stateNames) delete Object.prototype[name];
// Ahead of child.stdio below: the first read of a stdio property makes it an own property.
const own = Object.keys(child).filter(key => key.startsWith("std"));

console.log(JSON.stringify({ madeAhead: child.stdio.map(stream => stream && ahead.has(stream)), madeBehind, own }));

for (const stream of child.stdio) {
  if (!stream) continue;
  stream.on("error", () => {});
  if (stream.writable) stream.end();
  if (stream.readable) stream.resume();
}
