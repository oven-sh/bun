// What flow analysis finds follows from the program alone, so the order in which its rules run may not show in the machine code.
// That is not so yet for every program. It is so for the stored programs that ./programs-with-the-same-code-under-every-schedule.txt lists:
// each had the same code, function by function, under the usual schedule and under 255 others. Here each is asked under eight. Nor may it
// show how flow analysis numbers the objects that a program makes, how many threads the build has, or in how many passes the checker goes
// over the files.
//
// Why 255: the number of a schedule seeds a hash over the statements of the whole build, so every change to the compiler or to the library
// deals new schedules. A program that one schedule in thirty moves holds under eight more often than not, and would fail here one day for
// whoever changed something else. ./programs-with-the-same-code-under-nine-schedules.txt has the thousands that were asked so far and no further.
//
// The list only grows. A program that leaves it is a fault in flow analysis: the failure names the first function that differs, and
//   bun test/aot/tools/same-code-under-every-schedule.ts test/aot/parallel/<program>
// shows it alone. The same tool with `--schedules 255 --same <file>` says which programs can join.
import { expect } from "bun:test";
import { existsSync } from "fs";
import { bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { availableParallelism } from "os";
import { join } from "path";
import { test } from "./supported";
import {
  checkerPasses,
  findMovedCode,
  listedPrograms,
  numberings,
  programsAskedUnderNineSchedules,
  schedules,
  storedPrograms,
  threadCounts,
} from "./tools/same-code-under-every-schedule";

// A test file has three minutes on four processors: a share of the list at even distances. The tool takes all of it (`--from`).
const programsAsked = 24;
const all = listedPrograms();
const listed = all.filter((_, index) => index % Math.ceil(all.length / programsAsked) === 0);
const jobs = Math.max(1, Number(process.env.AOT_PROGRAMS_JOBS) || Math.min(9, availableParallelism()));

// The library that a program brings along is another on each system, and a Bun that checks itself generates other code.
// The list is what holds on Linux, on x64 and on arm64 alike.
const onTheSystemOfTheList = test.skipIf(!isLinux || isASAN || isDebug);

test("every listed program is there", () => {
  const isGone = (program: string) => !existsSync(join(storedPrograms, program));
  expect([...all, ...programsAskedUnderNineSchedules()].filter(isGone)).toEqual([]);
});

onTheSystemOfTheList.each([
  ["under nine schedules", schedules(8)],
  [
    "with other numbers for objects, on one thread and on eight, with two and three passes of the checker",
    [...schedules(0), ...numberings(4), ...threadCounts([1, 8]), ...checkerPasses([2, 3])],
  ],
])(
  "the listed programs have the same code %s",
  async (_, ways) => {
    using work = tempDir("aot-same-code-under-every-schedule", {});
    expect(await findMovedCode(bunExe(), storedPrograms, listed, ways, String(work), jobs)).toEqual({
      moved: [],
      notBuilt: [],
    });
  },
  170_000,
);

onTheSystemOfTheList(
  "code that does move is reported",
  async () => {
    using work = tempDir("aot-same-code-under-every-schedule", {});
    const ways = [
      { name: "usual", flags: [] },
      { name: "cold", flags: ["--aot-heat=everything-is-cold"] },
    ];
    const { moved, notBuilt } = await findMovedCode(
      bunExe(),
      storedPrograms,
      listed.slice(0, 2),
      ways,
      String(work),
      jobs,
    );
    expect({ moved: moved.map(({ program, under }) => ({ program, under })), notBuilt }).toEqual({
      moved: listed.slice(0, 2).map(program => ({ program, under: ["cold"] })),
      notBuilt: [],
    });
  },
  120_000,
);
