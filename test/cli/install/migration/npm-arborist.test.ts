import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";
import { arboristFixtures, fixture, readLock, run } from "./migration-harness";

// The default 5 s is not enough for a debug build in a container: a child process, or the harness call that copies or
// removes a fixture, now and then stalls for longer than that, and the case that waits at that moment would fail.
setDefaultTimeout(60_000);

// Every lockfile under npm-arborist/ is migrated and round-tripped through --frozen-lockfile; the report is snapshotted.
describe("package-lock.json migration fixes", () => {
  describe("arborist fixtures", () => {
    const names = arboristFixtures.map(f => f.name);

    async function roundTrip(name: string) {
      using dir = fixture(name);
      const lockPath = join(String(dir), "bun.lock");
      const migrate = await run(dir, "pm", "migrate", "--verbose");
      if (migrate.exitCode !== 0) return { migrate, wroteLock: existsSync(lockPath) };
      const { text: lock } = await readLock(dir);
      const check = await run(dir, "install", "--frozen-lockfile", "--lockfile-only");
      return { migrate, lock, check, lockAfterCheck: await Bun.file(lockPath).text() };
    }

    // Snapshot matchers are unsupported inside a concurrent group, so the cases stay sequential. Their child processes
    // are what takes the time, and those overlap: a case starts its fixture and the three after it, then awaits its own.
    const trips = new Map<string, ReturnType<typeof roundTrip>>();
    function start(name: string) {
      if (trips.has(name)) return;
      const trip = roundTrip(name);
      // A round trip that throws fails the case that awaits it, not the case that runs when it throws.
      trip.catch(() => {});
      trips.set(name, trip);
    }
    // A filtered run starts round trips that no case awaits. They end before the file does.
    afterAll(() => Promise.allSettled(trips.values()));

    // The errors, warnings and notes of `bun install`. macOS has another name for a connection that the offline
    // registry refuses.
    const diagnostics = (stderr: string) =>
      stderr
        .split("\n")
        .filter(line => /^(error|warn|note): /.test(line))
        .map(line =>
          line.replace(/^(\w+): FailedToOpenSocket (downloading package manifest )/, "$1: ConnectionRefused $2"),
        );

    test.each(names)("%s", async name => {
      const at = names.indexOf(name);
      names.slice(at, at + 4).forEach(start);
      const trip = await trips.get(name)!;

      expect(trip.migrate.stdout).toBe("");
      const report = [
        trip.migrate.stderr.replace(/^\[[\d.]+m?s\] /gm, "").trimEnd(),
        `bun pm migrate exit code: ${trip.migrate.exitCode}`,
      ];
      if (trip.check) {
        expect(trip.check.stdout.split("\n")).toEqual([expect.stringContaining("bun install v1."), ""]);
        // --frozen-lockfile does not rewrite the lockfile, whether it accepts it or not.
        expect(trip.lockAfterCheck).toBe(trip.lock);
        report.push(
          ...diagnostics(trip.check.stderr),
          `bun install --frozen-lockfile exit code: ${trip.check.exitCode}`,
          "",
          trip.lock,
        );
      } else {
        // A migration that fails leaves no bun.lock.
        expect(trip.wroteLock).toBe(false);
      }
      expect(report.join("\n")).toMatchSnapshot();
    });
  });
});
