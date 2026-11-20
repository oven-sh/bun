const graph = new (Bun as any).ModuleGraph({ globals: { greeting: "hello" } });
console.log(typeof graph, Object.prototype.toString.call(graph), typeof (Bun as any).ModuleGraph);
