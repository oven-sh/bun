// A CommonJS file that an ES module imports runs before every ES body of the graph, also before one that is imported ahead of it.
import "./a.mjs";
import "./b.cjs";
console.log("main");
