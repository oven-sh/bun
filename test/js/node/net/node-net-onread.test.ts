import { describe, expect, test } from "bun:test";
import { cells, consumerNames, runCell } from "./node-net-onread-fixture.cjs";
import nodeTraces from "./node-net-onread.node-traces.json";

// Node reads at most one onread buffer per kernel read and runs the tick queue between two reads. Bun hands the
// callback every slice of one native read in a loop. on('data') and resume() inside the first callback queue a tick
// that calls read(). In node it runs before the second callback, in bun after it, where it undoes the `false` the
// second callback returned.
const bunDiffers: Record<string, string> = {
  "tcp/burst/data/firstSlice/falseThenRead": "AAAA attach BBBB return-false CCCC DDDD EEEE end close",
  "tcp/burst/data/firstSlice/falseThenResume": "AAAA attach BBBB return-false CCCC DDDD EEEE end close",
  "tcp/burst/pauseResumeSync/firstSlice/falseThenRead":
    "AAAA attach pause();resume() BBBB return-false CCCC DDDD EEEE end close",
  "tcp/burst/pauseResumeSync/firstSlice/falseThenResume":
    "AAAA attach pause();resume() BBBB return-false CCCC DDDD EEEE end close",
};

// The stream's paused/flowing state does not stop an onread socket in node: only a `false` return and pause() on a
// connected socket do, and read(), resume() and _read() start it again. The fixture says what a cell is.
describe("net.Socket onread: what else uses the read side does not stop the callback", () => {
  test.each(consumerNames)("%s", async consumer => {
    const names = cells.filter(name => name.split("/")[2] === consumer);
    const expected = Object.fromEntries(names.map(name => [name, bunDiffers[name] ?? nodeTraces[name]]));
    const actual = Object.fromEntries(await Promise.all(names.map(async name => [name, await runCell(name)])));
    expect(actual).toEqual(expected);
  });
});
