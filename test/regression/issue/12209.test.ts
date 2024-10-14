import { test, expect } from "bun:test";
import { bunExe } from "harness";
import { execFile } from "node:child_process";
import util from "node:util";

const execFileAsync = util.promisify(execFile);

test("https://github.com/oven-sh/bun/issues/12209", async () => {
	// use these instead of [1,2,3] so it's easier to .toContain it
	const numArgs = ["7392", "5104", "8627"];
	const args = ["-e", "console.log(process.argv)", ...numArgs];
	const result = await execFileAsync(bunExe(), args);
	for (const numArg of numArgs) {
		expect(result.stdout).toContain(numArg);
	}
	expect(result.stderr).toBe("");
});
