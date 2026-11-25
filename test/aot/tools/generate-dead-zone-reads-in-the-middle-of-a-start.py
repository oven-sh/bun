#!/usr/bin/env python3
# Writes ../parallel/dead-zone-read-in-the-middle-of-a-start/: ONE DEED A PROGRAM. In each, code of the program is started or resumed IN THE MIDDLE OF A START (a job, a timer, a handler, another module of a cycle, a module that threw, text made at run time ..)
# and reads a `const` of a module in front of its store: a ReferenceError there, and the value behind the store where the program gets that far.
import os, shutil, sys
folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'parallel', 'dead-zone-read-in-the-middle-of-a-start')
read = 'function read() { try { return late.rate; } catch (error) { return error.name; } }\n'
store = 'const late = { rate: 0.2 };\n'
one = {}
def awaited(name, start, wait='await new Promise(resolve => setTimeout(resolve, 30));\n'):
    one[name + '.mjs'] = read + 'let seen = "not run";\n' + start + wait + store + 'console.log(seen, read());\n'
awaited('timer-fires-under-a-top-level-await', 'setTimeout(() => { seen = read(); }, 0);\n')
awaited('interval-fires-under-a-top-level-await', 'const timer = setInterval(() => { seen = read(); clearInterval(timer); }, 1);\n')
awaited('immediate-fires-under-a-top-level-await', 'setImmediate(() => { seen = read(); });\n')
awaited('job-of-a-promise-runs-under-a-top-level-await', 'Promise.resolve().then(() => { seen = read(); });\n', 'await null;\n')
awaited('queued-microtask-runs-under-a-top-level-await', 'queueMicrotask(() => { seen = read(); });\n', 'await null;\n')
awaited('next-tick-runs-under-a-top-level-await', 'process.nextTick(() => { seen = read(); });\n', 'await new Promise(resolve => setImmediate(resolve));\n')
awaited('async-function-goes-on-under-a-top-level-await', 'async function later() { await null; seen = read(); }\nlater();\n', 'await null;\nawait null;\nawait null;\n')
awaited('async-generator-goes-on-under-a-top-level-await', 'async function* steps() { yield 1; seen = read(); }\nconst walked = (async () => { for await (const step of steps()); })();\n', 'await walked;\n')
awaited('rejection-handler-runs-under-a-top-level-await', 'Promise.reject(new Error("no")).catch(() => { seen = read(); });\n', 'await null;\nawait null;\n')
awaited('finally-handler-runs-under-a-top-level-await', 'Promise.resolve().finally(() => { seen = read(); });\n', 'await null;\nawait null;\n')
awaited('message-channel-delivers-under-a-top-level-await', 'const channel = new MessageChannel();\nchannel.port1.onmessage = () => { seen = read(); channel.port1.close(); };\nchannel.port2.postMessage(1);\n')
awaited('event-target-dispatches-in-a-timer-under-a-top-level-await', 'const target = new EventTarget();\ntarget.addEventListener("go", () => { seen = read(); });\nsetTimeout(() => target.dispatchEvent(new Event("go")), 0);\n')
awaited('file-read-calls-back-under-a-top-level-await', 'import { readFile } from "node:fs";\nreadFile(import.meta.filename ?? process.argv[1], () => { seen = read(); });\n', 'await new Promise(resolve => setTimeout(resolve, 60));\n')
awaited('finalizer-runs-under-a-top-level-await', 'const registry = new FinalizationRegistry(() => { seen = read(); });\n(() => { registry.register({}, 1); })();\nBun.gc(true);\n', 'await new Promise(resolve => setTimeout(resolve, 30));\nBun.gc(true);\nawait new Promise(resolve => setTimeout(resolve, 30));\nif (seen === "not run") seen = "ReferenceError";\n')
def sync(name, deed, extension='.js'):
    one[name + extension] = read + 'let seen = "not run";\n' + deed + store + 'console.log(seen, read());\n'
sync('listener-called-by-dispatch-event', 'const target = new EventTarget();\ntarget.addEventListener("go", () => { seen = read(); });\ntarget.dispatchEvent(new Event("go"));\n')
sync('listener-called-by-abort', 'const controller = new AbortController();\ncontroller.signal.addEventListener("abort", () => { seen = read(); });\ncontroller.abort();\n')
sync('listener-called-by-emit', 'const { EventEmitter } = require("node:events");\nconst emitter = new EventEmitter();\nemitter.on("go", () => { seen = read(); });\nemitter.emit("go");\n', '.cjs')
sync('executor-of-a-promise', 'new Promise(() => { seen = read(); });\n')
sync('mapper-of-array-from', 'Array.from({ length: 1 }, () => { seen = read(); });\n')
sync('reviver-of-json-parse', 'JSON.parse("1", () => { seen = read(); });\n')
sync('replacer-of-json-stringify', 'JSON.stringify({ a: 1 }, (key, value) => { seen = read(); return value; });\n')
sync('callback-of-for-each-of-a-map', 'new Map([[1, 1]]).forEach(() => { seen = read(); });\n')
sync('callback-of-for-each-of-a-set', 'new Set([1]).forEach(() => { seen = read(); });\n')
sync('callback-of-reduce', '[1, 2].reduce(() => { seen = read(); });\n')
sync('callback-of-find', '[1].find(() => { seen = read(); });\n')
sync('callback-of-flat-map', '[1].flatMap(() => { seen = read(); return []; });\n')
sync('callback-of-typed-array-map', 'new Uint8Array(1).map(() => { seen = read(); return 0; });\n')
sync('callback-of-replace-all', '"a".replaceAll("a", () => { seen = read(); return ""; });\n')
sync('callback-of-group-by', 'Object.groupBy([1], () => { seen = read(); return "k"; });\n')
sync('static-block-of-a-class', 'class Early { static { seen = read(); } }\n')
sync('static-field-of-a-class', 'class Early { static rate = (seen = read()); }\n')
sync('computed-key-of-a-literal', '({ [(seen = read())]: 1 });\n')
sync('prepare-stack-trace', 'Error.prepareStackTrace = () => { seen = read(); return ""; };\nnew Error("x").stack;\nError.prepareStackTrace = undefined;\n')
sync('to-string-tag-getter', 'const tagged = {};\nObject.defineProperty(tagged, Symbol.toStringTag, { get() { seen = read(); return "T"; } });\nObject.prototype.toString.call(tagged);\n')
sync('disposer-of-a-using-declaration', '{ using held = { [Symbol.dispose]() { seen = read(); } }; }\n', '.ts')
sync('indirect-eval-calls-a-global', 'globalThis.readLate = read;\nseen = (0, eval)("readLate()");\n')
sync('direct-eval-names-the-function', 'seen = eval("read()");\n')
sync('direct-eval-names-the-variable', 'try { seen = eval("late.rate"); } catch (error) { seen = error.name; }\n')
sync('new-function-calls-a-global', 'globalThis.readLate = read;\nseen = new Function("return readLate()")();\n')
sync('vm-script-calls-a-global', 'globalThis.readLate = read;\nseen = require("node:vm").runInThisContext("readLate()");\n', '.cjs')
sync('generator-resumed', 'function* steps() { yield 1; seen = read(); }\nconst walked = steps();\nwalked.next();\nwalked.next();\n')
sync('inspect-custom-by-console-log', 'const shown = { [Symbol.for("nodejs.util.inspect.custom")]() { seen = read(); return "shown"; } };\nconsole.log(shown);\n')
sync('inspect-custom-by-util-inspect', 'const shown = { [Symbol.for("nodejs.util.inspect.custom")]() { seen = read(); return "shown"; } };\nrequire("node:util").inspect(shown);\n', '.cjs')
one['exit-handler-runs-while-the-body-is-unfinished.js'] = read + 'process.on("exit", () => { console.log("at exit", read()); });\nif (process.argv.length < 99) process.exit(0);\n' + store + 'console.log(read());\n'
one['before-exit-handler-of-a-body-that-threw.js'] = read + 'process.on("uncaughtException", () => { console.log("caught", read()); });\nif (process.argv.length < 99) throw new Error("out of the body");\n' + store + 'console.log(read());\n'
one['unhandled-rejection-handler-under-a-top-level-await.mjs'] = read + 'let seen = "not run";\nprocess.on("unhandledRejection", () => { seen = read(); });\nPromise.reject(new Error("no"));\nawait new Promise(resolve => setTimeout(resolve, 30));\n' + store + 'console.log(seen, read());\n'
many = {
 'cycle-of-modules-a-hoisted-function-is-called-below': {
   'main.mjs': 'import "./below.mjs";\nexport function read() { try { return late.rate; } catch (error) { return error.name; } }\n' + store + 'console.log("main", read());\n',
   'below.mjs': 'import { read } from "./main.mjs";\nconsole.log("below", read());\n' },
 'cycle-of-modules-the-binding-itself-is-read-below': {
   'main.mjs': 'import "./below.mjs";\nexport const late = { rate: 0.2 };\nconsole.log("main", late.rate);\n',
   'below.mjs': 'import { late } from "./main.mjs";\nlet seen;\ntry { seen = late.rate; } catch (error) { seen = error.name; }\nconsole.log("below", seen);\n' },
 'cycle-of-modules-the-namespace-is-read-below': {
   'main.mjs': 'import "./below.mjs";\nexport const late = { rate: 0.2 };\nconsole.log("main", late.rate);\n',
   'below.mjs': 'import * as main from "./main.mjs";\nlet seen;\ntry { seen = main.late.rate; } catch (error) { seen = error.name; }\nconsole.log("below", seen);\n' },
 'cycle-of-commonjs-files-a-function-exported-early-is-called-below': {
   'main.cjs': 'exports.read = function () { try { return late.rate; } catch (error) { return error.name; } };\nrequire("./below.cjs");\n' + store + 'console.log("main", exports.read());\n',
   'below.cjs': 'const main = require("./main.cjs");\nconsole.log("below", main.read());\n' },
 'import-call-settles-under-a-top-level-await': {
   'main.mjs': 'export function read() { try { return late.rate; } catch (error) { return error.name; } }\nawait import("./below.mjs");\n' + store + 'console.log("main", read());\n',
   'below.mjs': 'import { read } from "./main.mjs";\nconsole.log("below", read());\n' },
 'module-that-threw-left-a-function-behind': {
   'main.mjs': 'try { await import("./thrower.mjs"); } catch (error) { console.log("threw", error.message); }\nconsole.log("main", globalThis.readThrower());\n',
   'thrower.mjs': 'globalThis.readThrower = function () { try { return late.rate; } catch (error) { return error.name; } };\nif (process.argv.length < 99) throw new Error("half-way");\n' + store },
 'commonjs-file-that-threw-left-a-function-behind': {
   'main.cjs': 'try { require("./thrower.cjs"); } catch (error) { console.log("threw", error.message); }\nconsole.log("main", globalThis.readThrower());\n',
   'thrower.cjs': 'globalThis.readThrower = function () { try { return late.rate; } catch (error) { return error.name; } };\nif (process.argv.length < 99) throw new Error("half-way");\n' + store },
 'worker-starts-while-the-body-is-unfinished': {
   'main.mjs': 'import { Worker } from "node:worker_threads";\nfunction read() { try { return late.rate; } catch (error) { return error.name; } }\nlet seen = "not run";\nconst worker = new Worker(new URL("./job.mjs", import.meta.url));\nworker.on("message", () => { seen = read(); });\nawait new Promise(resolve => worker.on("exit", resolve));\n' + store + 'console.log(seen, read());\n',
   'job.mjs': 'import { parentPort } from "node:worker_threads";\nparentPort.postMessage(1);\n' },
}
shutil.rmtree(folder, ignore_errors=True); os.makedirs(folder)
for name, text in one.items(): open(os.path.join(folder, name), 'w').write(text)
for name, files in many.items():
    os.makedirs(os.path.join(folder, name))
    for file, text in files.items(): open(os.path.join(folder, name, file), 'w').write(text)
print(len(one) + len(many), 'programs')
