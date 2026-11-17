const words = ["alpha", "beta", "gamma", "delta"];
let hits = 0;
for (let round = 0; round < 2000; round++) {
    for (const word of words) {
        const pattern = new RegExp("^" + word.slice(0, 2) + "[a-z]+" + (round % 3 ? "$" : "a$"), round % 2 ? "i" : "");
        for (const other of words) hits += pattern.test(other) ? 1 : 0;
    }
}
console.log(hits, "a-b-c".replace(/-/g, "+"), "x1y22z333".match(/\d+/g)!.join());
