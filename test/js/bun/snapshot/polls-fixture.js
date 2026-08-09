// Built with stdin = a pipe the builder never reads to EOF (a FilePoll on fd 0 is in the snapshot) and after one DNS lookup
// (dns_sd's per-process shared connection). Restored with a fresh stdin pipe: the poll must follow the new fd, and
// nothing may be delivered before 'restore'.
const events = [];
process.stdin.on("data", d => events.push("stdin:" + d.toString().trim()));
process.stdin.on("end", () => events.push("stdin-end"));
process.on("restore", async () => {
  events.push("restore");
  const addrs = await Bun.dns.lookup("localhost").catch(e => "ERR:" + e.code);
  events.push(Array.isArray(addrs) && addrs.length ? "dns-ok" : "dns:" + JSON.stringify(addrs));
  const deadline = Date.now() + 5000;
  while (!events.some(e => e.startsWith("stdin")) && Date.now() < deadline) await Bun.sleep(10);
  console.log("[js] " + JSON.stringify(events));
  process.exit(0);
});
await Bun.dns.lookup("localhost").catch(() => {});
setTimeout(() => Bun.startupSnapshot.take({ timers: "keep" }), 100);
