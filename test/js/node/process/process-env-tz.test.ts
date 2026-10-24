// TZ takes more than a zone name: the C library also reads ":name" and a POSIX value such as "MSK-3".
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";

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
  // The C library reads a name after ":", and the same zones again under "posix/".
  [":Europe/Moscow", [-180, -180, "Europe/Moscow"]],
  ["posix/Europe/Moscow", [-180, -180, "Europe/Moscow"]],
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
      // A zone name that looks like a POSIX value is the zone of the name.
      ["EST5EDT", [300, 240, "America/New_York"]],
    ];
    // Only the C library reads what follows `std offset` in a POSIX value, and the tzfile at a path. It reads the
    // environment and not an assignment, so those values give the zone of the host. No zone has a name for 7:15,
    // 15 or 13 hours from UTC.
    const forHost = [
      "XYZ-7:15XYS,M3.5.0,M10.5.0/3",
      "XYZ-7:15",
      "<+1030>-10:30",
      "XYZ-15",
      "XYZ+13",
      "XYZ-3x",
      "/usr/share/zoneinfo/Asia/Kolkata",
      "",
    ];
    // As in Node, a value that is not a time zone is UTC.
    const notAZone = [
      "Not/AZone",
      "undefined",
      "europe/paris",
      "XYZ",
      "AB-3",
      "<XY>-3",
      "XYZ-25",
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
          exact: ${JSON.stringify([...exact, ...posixEdges].map(([value]) => value))}.map(after),
          // One more character than the runtime setter used to take.
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
        exact: [...exact, ...posixEdges].map(([, zone]) => zone),
        longName: [180, 180],
        forHost: forHost.map(() => host),
        notAZone: notAZone.map(() => [0, 0, "UTC"]),
      },
      stderr: "",
      exitCode: 0,
    });
  });
});
