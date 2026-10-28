// TZ takes more than a zone name: the C library also reads ":name" and a POSIX value such as "MSK-3".
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isMacOSVersionAtLeast, tempDir } from "harness";

// getTimezoneOffset() for 09:00 local time on 15 January and on 15 July 2026, and the zone that Intl reports.
type Zone = [january: number, july: number, timeZone: string];

const probe = `
  const zone = () => [
    new Date(2026, 0, 15, 9).getTimezoneOffset(),
    new Date(2026, 6, 15, 9).getTimezoneOffset(),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ];`;

async function run(options: {
  cmd?: string[];
  script?: string;
  env: Record<string, string | undefined>;
  cwd?: string;
}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...(options.cmd ?? ["-e", options.script ?? `${probe} console.log(JSON.stringify(zone()));`])],
    env: { ...bunEnv, ...options.env },
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

// The offset in a POSIX value counts west of Greenwich. A whole number of hours from UTC is an IANA zone.
const exact: [value: string, zone: Zone][] = [
  ["MSK-3", [-180, -180, "Etc/GMT-3"]],
  ["EST5", [300, 300, "Etc/GMT+5"]],
  ["<+03>-3", [-180, -180, "Etc/GMT-3"]],
  ["UTC0", [0, 0, "UTC"]],
  // ICU reads "GMT+3" as three hours east. In TZ it is a POSIX value, three hours west: date(1) and Node on Linux agree.
  ["GMT+3", [180, 180, "Etc/GMT+3"]],
  // The C library reads a name after ":", and the same zones again under "posix/" and "right/".
  [":Europe/Moscow", [-180, -180, "Europe/Moscow"]],
  ["posix/Europe/Moscow", [-180, -180, "Europe/Moscow"]],
  ["right/Europe/Moscow", [-180, -180, "Europe/Moscow"]],
];

describe.concurrent("TZ at the start of the process", () => {
  test.each(exact)("TZ=%s in the environment", async (value, zone) => {
    const { stdout, stderr, exitCode } = await run({ env: { TZ: value } });
    expect({ zone: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({ zone, stderr: "", exitCode: 0 });
  });

  // ICU and the C library read the environment, and not a .env file.
  test.each(exact)("TZ=%s in a .env file", async (value, zone) => {
    using dir = tempDir("tz-dotenv", { ".env": `TZ="${value}"\n` });
    const { stdout, stderr, exitCode } = await run({ env: { TZ: undefined }, cwd: String(dir) });
    expect({ zone: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({ zone, stderr: "", exitCode: 0 });
  });

  // A Worker has no TZ of its own: the zone is the one of the process.
  test("a Worker has the zone of a POSIX value", async () => {
    using dir = tempDir("tz-worker", {
      "main.js": `
        import { Worker } from "node:worker_threads";
        const worker = new Worker(new URL("./worker.js", import.meta.url));
        worker.on("message", message => { console.log(JSON.stringify(message)); });`,
      "worker.js": `
        import { parentPort } from "node:worker_threads";
        ${probe}
        parentPort.postMessage(zone());`,
    });
    const { stdout, stderr, exitCode } = await run({ cmd: ["main.js"], env: { TZ: "MSK-3" }, cwd: String(dir) });
    expect({ zone: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      zone: [-180, -180, "Etc/GMT-3"],
      stderr: "",
      exitCode: 0,
    });
  });

  test("bun repl reads a POSIX value", async () => {
    const { stdout, stderr, exitCode } = await run({
      cmd: ["repl", "-e", `${probe} console.log(JSON.stringify(zone()));`],
      env: { TZ: "MSK-3" },
    });
    expect({ zone: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      zone: [-180, -180, "Etc/GMT-3"],
      stderr: "",
      exitCode: 0,
    });
  });

  // A start leaves a value that is not a zone to the host. On Linux the host is the ICU of Bun, which gives back the
  // TZ of the environment, and JavaScriptCore finds a zone name in any case. date(1) and Node give UTC for this value.
  test.skipIf(!isLinux)("a value that is not a zone is for the host at a start, and UTC when assigned", async () => {
    const { stdout, stderr, exitCode } = await run({
      env: { TZ: "europe/paris" },
      script: `${probe}
        const start = zone();
        process.env.TZ = process.env.TZ;
        console.log(JSON.stringify({ start, assigned: zone() }));`,
    });
    expect({ result: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      result: { start: [-60, -120, "Europe/Paris"], assigned: [0, 0, "UTC"] },
      stderr: "",
      exitCode: 0,
    });
  });
});

describe("process.env.TZ = value", () => {
  test("sets the zone of the value, and never keeps the previous zone", async () => {
    // The edges of `std offset` in POSIX: a name of three letters or more, or in "<>", then [+-]hh[:mm[:ss]].
    const posixEdges: [value: string, zone: Zone][] = [
      ["XYZ-14", [-840, -840, "Etc/GMT-14"]],
      ["XYZ12", [720, 720, "Etc/GMT+12"]],
      ["XYZ+0", [0, 0, "UTC"]],
      ["XYZ-0:00:00", [0, 0, "UTC"]],
      ["<-03>3", [180, 180, "Etc/GMT+3"]],
      // The C library reads every digit of the hours.
      ["XYZ-003", [-180, -180, "Etc/GMT-3"]],
      ["GMT+0000", [0, 0, "UTC"]],
      // glibc reads a POSIX value after ":" when no tzfile has that name.
      [":MSK-3", [-180, -180, "Etc/GMT-3"]],
      // "GMT" in any case is a name as any other here. ICU reads the sign after it the other way.
      ["gmt+3", [180, 180, "Etc/GMT+3"]],
      ["GMT-3", [-180, -180, "Etc/GMT-3"]],
    ];
    // A name that ICU has a zone for is the zone of the name, also one that starts as a POSIX value ("EST5EDT").
    // date(1) and Node give UTC for "CST".
    const icuNames: [value: string, zone: Zone][] = [["CST", [360, 300, "America/Chicago"]]];
    // On macOS 15 the row is [0, 0, "UTC"]: the system ICU takes the name, and JavaScriptCore has no zone for it.
    if (!isMacOS || isMacOSVersionAtLeast(26)) icuNames.push(["EST5EDT", [300, 240, "America/New_York"]]);
    // Only the C library reads the tzfile at a path, and what follows `std offset` in a POSIX value. It reads the
    // environment and not an assignment, so those values give the zone of the host. So does a value with no zone
    // name: 7:15, 13, 15 or 24 hours from UTC.
    // Node gives UTC for "", and the zone of the value for "XYZ-15", "XYZ+13", "XYZ-24", "GMT+13" and a path.
    const forHost = [
      "XYZ-7:15XYS,M3.5.0,M10.5.0/3",
      "XYZ-7:15",
      "<+1030>-10:30",
      "XYZ-15",
      "XYZ+13",
      "XYZ-24",
      "XYZ-3x",
      "GMT+5:30",
      "GMT+13",
      "/usr/share/zoneinfo/Asia/Kolkata",
      ":/usr/share/zoneinfo/Asia/Kolkata",
      "",
    ];
    // Not a zone name and not a POSIX value: UTC. Node writes the C environment and ICU reads the zone again
    // (https://github.com/nodejs/node/blob/v26.3.0/src/node_env_var.cc#L78-L105). That is UTC for these values too,
    // but not for "XYZ-25" (24 hours east), and "XYZ-3:60" and "XYZ-4294967299" (the zone of /etc/localtime).
    const notAZone = [
      "Not/AZone",
      "undefined",
      "europe/paris",
      ":",
      "posix/",
      // A file name follows "posix/", and not a POSIX value.
      "posix/MSK-3",
      "XYZ",
      "AB-3",
      "<XY>-3",
      "XYZ-25",
      // 2 ** 32 + 3 hours: the number must not wrap to 3.
      "XYZ-4294967299",
      "XYZ-3:60",
      Buffer.alloc(4096, "A").toString(),
    ];
    const { stdout, stderr, exitCode } = await run({
      env: { TZ: "America/Los_Angeles" },
      script: `${probe}
        delete process.env.TZ;
        const host = zone();
        const after = value => {
          process.env.TZ = "Asia/Tokyo";
          process.env.TZ = value;
          return zone();
        };
        console.log(JSON.stringify({
          host,
          exact: ${JSON.stringify([...exact, ...posixEdges, ...icuNames].map(([value]) => value))}.map(after),
          // The longest zone name: 32 characters.
          longName: after("America/Argentina/ComodRivadavia").slice(0, 2),
          forHost: ${JSON.stringify(forHost)}.map(after),
          notAZone: ${JSON.stringify(notAZone)}.map(after),
        }));`,
    });
    const result = JSON.parse(stdout || "null");
    // The ICU that Bun has on Linux takes the zone of the host from the TZ of the environment.
    const host: Zone = isLinux ? [480, 420, "America/Los_Angeles"] : result?.host;
    expect({ result, stderr, exitCode }).toEqual({
      result: {
        host,
        exact: [...exact, ...posixEdges, ...icuNames].map(([, zone]) => zone),
        longName: [180, 180],
        forHost: forHost.map(() => host),
        notAZone: notAZone.map(() => [0, 0, "UTC"]),
      },
      stderr: "",
      exitCode: 0,
    });
  });
});
