import { stderr } from "bun";
import { bunEnv } from "harness";
import { bunExe } from "harness";
import { bun, bunRunAsScript, tempDirWithFiles } from "harness"

it("duplicate dependencies should warn instead of error", () => {
    const package_json = JSON.stringify({
        devDependencies: {
            vuex: "3.6.2"
        },
        dependencies: {
            vuex: "3.6.2"
        }
    })

    const dir = tempDirWithFiles('07740', {
        'package.json': package_json,
    });

    const proc = Bun.spawnSync([bunExe(), 'install'], {
        env: bunEnv,
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
    });

    const [stdout, stderr] = [
        proc.stdout.toString('utf-8').trim(),
        proc.stderr.toString('utf-8').trim()
    ]

    expect(stderr).not.toContain("error: Duplicate dependency:");
    expect(stderr).toContain("warn: Duplicate dependency");
    expect(stdout).toEqual("");
})
