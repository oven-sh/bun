// As files-of-pure-packages-behind-import-calls, with one file between the call and the pages, which imports them by statements.
const { pages } = await import("./middle.mjs");
for (const name in pages) console.log(name + ":", pages[name]());
