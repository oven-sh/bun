// Dates follow the launch's zone (TZ, or the machine's), not the zone of the process that built the snapshot.
const report = () => `[js] offset=${new Date(0).getTimezoneOffset()} zone=${Intl.DateTimeFormat().resolvedOptions().timeZone} str=${new Date(0).toString().slice(16, 33)}`;
new Date().toString(); // populate the caches while building, as a real app would
if (process.env.PLAIN) console.log(report());
else {
  process.on("restore", () => { console.log(report()); process.exit(0); });
  setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel" }), 10);
}
