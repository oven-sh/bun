import { describe, test, expect, beforeAll } from "bun:test";
import { spawnSync } from "bun";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

const cwd_root = tempDirWithFiles("testworkspace", {
	packages: {
		pkga: {
			"index.js": "console.log('pkga');",
			"package.json": JSON.stringify({
				name: "pkga",
				scripts: {
					present: "echo scripta",
				},
			}),
		},
		pkgb: {
			"index.js": "console.log('pkgb');",
			"package.json": JSON.stringify({
				name: "pkgb",
				scripts: {
					present: "echo scriptb",
				},
			}),
		},
		dirname: {
			"index.js": "console.log('pkgc');",
			"package.json": JSON.stringify({
				name: "pkgc",
				scripts: {
					present: "echo scriptc",
				},
			}),
		},
		malformed1: {
			"package.json": JSON.stringify({
				scripts: {
					present: "echo malformed1",
				},
			}),
		},
		malformed2: {
			"package.json": "asdfsadfas",
		},
		missing: {
			foo: "bar",
		},
	},
	"package.json": JSON.stringify({
		name: "ws",
		scripts: {
			present: "echo rootscript",
		},
		workspaces: [
			"packages/pkga",
			"packages/pkgb",
			"packages/dirname",
			"packages/malformed1",
			"packages/malformed2",
			"packages/missing",
		],
	}),
});

const cwd_packages = join(cwd_root, "packages");
const cwd_a = join(cwd_packages, "pkga");
const cwd_b = join(cwd_packages, "pkgb");
const cwd_c = join(cwd_packages, "dirname");

function runInCwdSuccess({
	cwd,
	pattern,
	target_pattern,
	antipattern,
	command = ["present"],
}: {
	cwd: string;
	pattern: string | string[];
	target_pattern: RegExp | RegExp[];
	antipattern?: RegExp | RegExp[];
	command?: string[];
}) {
	const cmd = [bunExe(), "run"];
	if (Array.isArray(pattern)) {
		for (const p of pattern) {
			cmd.push("--filter", p);
		}
	} else {
		cmd.push("--filter", pattern);
	}
	for (const c of command) {
		cmd.push(c);
	}
	const { exitCode, stdout, stderr } = spawnSync({
		cwd: cwd,
		cmd: cmd,
		env: bunEnv,
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdoutval = stdout.toString();
	for (const r of Array.isArray(target_pattern)
		? target_pattern
		: [target_pattern]) {
		expect(stdoutval).toMatch(r);
	}
	if (antipattern !== undefined) {
		for (const r of Array.isArray(antipattern) ? antipattern : [antipattern]) {
			expect(stdoutval).not.toMatch(r);
		}
	}
	// expect(stderr.toString()).toBeEmpty();
	expect(exitCode).toBe(0);
}

function runInCwdFailure(
	cwd: string,
	pkgname: string,
	scriptname: string,
	result: RegExp,
) {
	const { exitCode, stdout, stderr } = spawnSync({
		cwd: cwd,
		cmd: [bunExe(), "run", "--filter", pkgname, scriptname],
		env: bunEnv,
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(stdout.toString()).toBeEmpty();
	expect(stderr.toString()).toMatch(result);
	expect(exitCode).toBe(1);
}

describe("bun", () => {
	const dirs = [cwd_root, cwd_packages, cwd_a, cwd_b, cwd_c];
	const packages = [
		{
			name: "pkga",
			output: /scripta/,
		},
		{
			name: "pkgb",
			output: /scriptb/,
		},
		{
			name: "pkgc",
			output: /scriptc/,
		},
	];

	const names = packages.map((p) => p.name);
	for (const d of dirs) {
		for (const { name, output } of packages) {
			test(`resolve ${name} from ${d}`, () => {
				runInCwdSuccess({ cwd: d, pattern: name, target_pattern: output });
			});
		}
	}

	for (const d of dirs) {
		test(`resolve '*' from ${d}`, () => {
			runInCwdSuccess({
				cwd: d,
				pattern: "*",
				target_pattern: [/scripta/, /scriptb/, /scriptc/],
			});
		});
		test(`resolve all from ${d}`, () => {
			runInCwdSuccess({
				cwd: d,
				pattern: names,
				target_pattern: [/scripta/, /scriptb/, /scriptc/],
			});
		});
	}

	test("resolve all with glob", () => {
		runInCwdSuccess({
			cwd: cwd_root,
			pattern: "./packages/*",
			target_pattern: [/scripta/, /scriptb/, /scriptc/, /malformed1/],
		});
	});
	test("resolve all with recursive glob", () => {
		runInCwdSuccess({
			cwd: cwd_root,
			pattern: "./**",
			target_pattern: [/scripta/, /scriptb/, /scriptc/, /malformed1/],
		});
	});
	test("resolve 'pkga' and 'pkgb' but not 'pkgc' with targeted glob", () => {
		runInCwdSuccess({
			cwd: cwd_root,
			pattern: "./packages/pkg*",
			target_pattern: [/scripta/, /scriptb/],
			antipattern: /scriptc/,
		});
	});
	test("resolve package with missing name", () => {
		runInCwdSuccess({
			cwd: cwd_root,
			pattern: "./packages/malformed1",
			target_pattern: [/malformed1/],
			antipattern: [/scripta/, /scriptb/, /scriptc/],
		});
	});

	test.todo("resolve and run all js scripts", () => {
		console.log(cwd_root);
		runInCwdSuccess({
			cwd: cwd_root,
			pattern: "*",
			target_pattern: [/pkga/, /pkgb/, /pkgc/],
			antipattern: [],
			command: ["./index.js"],
		});
	});

	test("run binaries in package directories", () => {
		runInCwdSuccess({
			cwd: cwd_root,
			pattern: "*",
			target_pattern: [/pkga/, /pkgb/, /dirname/],
			antipattern: [],
			command: ["bun", "-e", "console.log(process.cwd())"],
		});
	});

	test("should error with missing script", () => {
		runInCwdFailure(cwd_root, "*", "notpresent", /found/);
	});
	test("should warn about malformed package.json", () => {
		runInCwdFailure(cwd_root, "*", "x", /Failed to parse package.json/);
	});
});
