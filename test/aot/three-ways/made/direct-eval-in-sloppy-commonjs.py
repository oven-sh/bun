#!/usr/bin/env python3
"""direct-eval-in-sloppy-commonjs.py <folder>: ONE CASE A FOLDER: A direct eval (or arguments.callee beside one) in SLOPPY CommonJS files. `function hidden() { return eval("require"); }` at the top level is the form packages write."""
import os, sys
out = sys.argv[1]
cases = {
 "callee-alone": {
  "main.cjs": "function g() { return arguments.callee; }\nconsole.log(g().name);\n"
 },
 "callee-and-an-eval-elsewhere": {
  "main.cjs": "function g() { return arguments.callee; }\nconst f = () => eval(\"1\");\nconsole.log(f(), g().name);\n"
 },
 "eval-alone-in-a-declaration": {
  "main.cjs": "function f() { return eval(\"1 + 1\"); }\nconsole.log(f());\n"
 },
 "eval-in-a-declaration-that-is-exported": {
  "main.cjs": "function f() { return eval(\"1 + 1\"); }\nmodule.exports = { f }; console.log(f());\n"
 },
 "eval-in-a-declaration-with-var": {
  "main.cjs": "function f() { var local = 5; return eval(\"local + 1\"); }\nconsole.log(f());\n"
 },
 "eval-in-a-function-expression": {
  "main.cjs": "const f = function () { return eval(\"1 + 1\"); };\nconsole.log(f());\n"
 },
 "eval-in-a-method": {
  "main.cjs": "const o = { f() { return eval(\"1 + 1\"); } };\nconsole.log(o.f());\n"
 },
 "eval-in-a-nested-declaration": {
  "main.cjs": "function outer() { function inner() { return eval(\"1 + 1\"); } return inner(); }\nconsole.log(outer());\n"
 },
 "eval-in-a-required-file": {
  "lib.cjs": "function f() { return eval(\"1 + 1\"); }\nmodule.exports = { f };\n",
  "main.cjs": "console.log(require(\"./lib.cjs\").f());\n"
 },
 "eval-require": {
  "main.cjs": "function hidden() { return eval(\"require\"); }\nconsole.log(typeof hidden()(\"node:path\").join);\n"
 }
}
for name, files in cases.items():
    os.makedirs(os.path.join(out, name), exist_ok=True)
    for f, text in files.items():
        open(os.path.join(out, name, f), "w").write(text)
print(len(cases), "cases")
