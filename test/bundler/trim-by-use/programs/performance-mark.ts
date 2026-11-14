const mark = performance.mark("start", { detail: { from: "a mark" } });
console.log(mark.name, mark.entryType, JSON.stringify(mark.detail), performance.getEntriesByName("start").length);
