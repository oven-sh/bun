const when = new Date(Date.UTC(2024, 6, 1, 12, 0, 0));
for (const timeZoneName of ["short", "long", "shortOffset", "longOffset", "shortGeneric", "longGeneric"] as const) {
  console.log(
    timeZoneName,
    "|",
    when.toLocaleTimeString("en-US", { timeZone: "Europe/Berlin", timeZoneName }),
    "|",
    when.toLocaleTimeString("de", { timeZone: "America/Los_Angeles", timeZoneName }),
    "|",
    when.toLocaleTimeString("ja", { timeZone: "Etc/GMT+5", timeZoneName }),
  );
}
console.log(
  (1234567.891).toLocaleString("de"),
  (0.256).toLocaleString("en-US", { style: "percent" }),
  (12).toLocaleString("ar-EG"),
);
for (let i = 0; i < 2000; i++) i.toLocaleString("fr", { minimumFractionDigits: i % 3 });
Bun.gc(true);
console.log("collected");
