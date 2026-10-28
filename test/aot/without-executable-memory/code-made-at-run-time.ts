const add = new Function("a", "b", "let s = 0; for (let i = 0; i < 20000; i++) s += a + b + i; return s;");
let total = 0;
for (let i = 0; i < 300; i++) total += add(i, 1);
console.log(total, (0, eval)("let t = 0; for (let i = 0; i < 300000; i++) t += i; t"));
