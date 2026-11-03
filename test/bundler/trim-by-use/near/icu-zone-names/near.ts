const zones = [
  "America/Los_Angeles",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Lord_Howe",
  "America/St_Johns",
  "Africa/Casablanca",
  "UTC",
  "Etc/GMT+5",
  "Etc/GMT-14",
  "Antarctica/Troll",
  "Asia/Pyongyang",
  "America/Nuuk",
  "Nowhere/Nothing",
  "EST5EDT",
];
for (const zone of zones) {
  process.env.TZ = zone;
  for (const ms of [Date.UTC(2024, 0, 15, 12), Date.UTC(2024, 6, 15, 12), Date.UTC(1900, 0, 1)]) {
    const date = new Date(ms);
    console.log(
      zone,
      "|",
      date.toString(),
      "|",
      date.toTimeString(),
      "|",
      `${date}`.length,
      date.getHours(),
      date.getTimezoneOffset(),
    );
  }
}
console.log(
  Date().length > 20,
  new Date(2024, 2, 10, 2, 30).toISOString(),
  Date.parse("2024-07-01T12:00:00"),
  JSON.stringify(new Date(0)),
);
console.log((1234567.891).toString(), (255).toString(16), (0.1).toFixed(20), ["b", "a", "ä"].sort().join());
Bun.gc(true);
console.log("collected");
