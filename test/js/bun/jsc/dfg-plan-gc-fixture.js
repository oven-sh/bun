// oven-sh/WebKit#308: after one gc(), no ClientRequest/IncomingMessage may be a
// RootMarkReason::JITWorkList root while DFG plans are queued.
"use strict";
const http = require("http");
const jsc = require("bun:jsc");
const N = 32;
let done = 0;
const refs = [];
const server = http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end("ok");
  })
  .listen(0, "127.0.0.1", () => {
    for (let i = 0; i < N; i++) {
      const req = http.get({ hostname: "127.0.0.1", port: server.address().port }, res => {
        res.resume();
        res.on("end", () => done++);
      });
      refs.push(new WeakRef(req));
    }
  });
setImmediate(function check() {
  if (done < N) return setImmediate(check);
  Bun.gc(true);
  const alive = refs.filter(r => r.deref()).length;
  // If nothing survived there cannot be a JITWorkList-rooted instance either;
  // skip the (expensive under ASAN) heap snapshot.
  let rooted = 0;
  if (alive > 0) {
    // Count ClientRequest / IncomingMessage instances that the debugging heap
    // snapshot attributes directly to the JIT worklist.
    const snap = jsc.generateHeapSnapshotForDebugging();
    const NF = 7;
    const RF = 3;
    const { nodes, nodeClassNames, roots, labels } = snap;
    const classOf = new Map();
    for (let i = 0; i < nodes.length; i += NF) classOf.set(nodes[i], nodeClassNames[nodes[i + 2]]);
    for (let i = 0; i < roots.length; i += RF) {
      const cn = classOf.get(roots[i]);
      if ((cn === "ClientRequest" || cn === "IncomingMessage") && labels[roots[i + 1]] === "JITWorkList") rooted++;
    }
  }
  console.log("jitworklist-rooted=" + rooted + " alive=" + alive);
  server.close();
});
