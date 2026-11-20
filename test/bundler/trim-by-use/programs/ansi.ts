const red = "\x1b[31mhello world, hello again\x1b[39m";
console.log(JSON.stringify(Bun.sliceAnsi(red, 6, 11)));
console.log(JSON.stringify(Bun.sliceAnsi("plain text", 0, 5, "…")));
console.log(JSON.stringify(Bun.wrapAnsi(red, 11)));
console.log(JSON.stringify(Bun.wrapAnsi("a verylongwordthatdoesnotfit b", 8, { hard: true })));
