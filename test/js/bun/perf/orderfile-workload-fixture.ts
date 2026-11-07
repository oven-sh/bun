// Runs the order file's interactive workload the way a CI build does: under
// node, through generate.ts's own runner. Prints what the workload wrote, so
// the test can tell whether it was actually typed its stdin.
//
//   node --experimental-strip-types orderfile-workload-fixture.ts <bun> <cli.js>
import { runCommand } from "../../../../scripts/orderfile/generate.ts";

const [exe, cliFixture] = process.argv.slice(2);
const result = runCommand([exe!, cliFixture!], {
  input: "world\none\ntwo\nquit\n",
  // Well under the real workload timeout: a workload handed no stdin hangs, and
  // the test should fail rather than sit there.
  timeout: 30_000,
  label: "cli workload",
});
process.stdout.write(result.stdout.toString());
// Not process.exit(), which can truncate the write above.
process.exitCode = result.status ?? 1;
