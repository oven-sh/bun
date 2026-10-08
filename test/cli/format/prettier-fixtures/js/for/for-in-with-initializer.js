// https://github.com/babel/babel/blob/HEAD/packages/babel-generator/test/fixtures/parentheses/in-inside-for/input.js

for (var a = (b in c) in {});
for (var a = 1 || (b in c) in {});
for (var a = 1 + (2 || (b in c)) in {});
for (var a = (() => b in c) in {});
for (var a = 1 || (() => b in c) in {});
for (var a = (() => { b in c; }) in {});
for (var a = [b in c] in {});
for (var a = {b: b in c} in {});
// Meriyah can't parse
// for (var a = (x = b in c) => {} in {});
for (var a = class extends (b in c) {} in {});
for (var a = function (x = b in c) {} in {});
