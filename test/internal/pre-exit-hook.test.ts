// .buildkite/hooks/pre-exit posts a fallback Buildkite annotation for jobs
// that die before the runner/build reporter could post one: command-hook
// failures and, since #37246, job-level timeouts (which previously produced a
// red job with no annotation at all, hiding the darwin tart pre-warm hangs).
// These tests run the hook with a stubbed `buildkite-agent` and assert which
// exits annotate and what the annotation carries.
import { expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir } from "harness";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The hook is bash; on Windows CI it runs under Git Bash, but these tests
// only need one posix lane to cover it. Each run is hermetic (own tempDir,
// unique job id), so they run concurrently.
const t = isWindows ? test.skip : test.concurrent;

const hookPath = join(import.meta.dir, "../../.buildkite/hooks/pre-exit");

interface HookRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  annotations: string[];
  annotateArgs: string[];
}

async function runHook(env: Record<string, string>, opts?: { reported?: boolean }): Promise<HookRun> {
  using dir = tempDir("pre-exit-hook", {
    // Stand-in for /var/db/dhcpd_leases; the hook reads it via
    // PRE_EXIT_DHCPD_LEASES_FILE so the branch is reachable off-macOS.
    "dhcpd_leases": Array.from(
      { length: 2 },
      (_, i) =>
        `{\n\tname=bk-old-job-${i}\n\tip_address=192.168.64.${i + 2}\n\thw_address=1,aa:bb:cc:dd:ee:0${i}\n\tlease=0x69875a00\n}`,
    ).join("\n"),
  });
  const binDir = join(String(dir), "bin");
  const outDir = join(String(dir), "out");
  mkdirSync(binDir);
  mkdirSync(outDir);

  // Stub buildkite-agent: `meta-data exists` reflects opts.reported, and
  // `annotate` records its stdin and argv.
  writeFileSync(
    join(binDir, "buildkite-agent"),
    `#!/usr/bin/env bash
case "$1" in
  meta-data) ${opts?.reported ? "exit 0" : "exit 1"} ;;
  annotate) cat > "${outDir}/annotation.$$"; printf '%s\\n' "$@" > "${outDir}/annotate-args.$$"; exit 0 ;;
  *) exit 2 ;;
esac
`,
    { mode: 0o755 },
  );
  // Stub tart so the timed-out tart branch is exercisable off-macOS.
  writeFileSync(
    join(binDir, "tart"),
    `#!/usr/bin/env bash
[ "$1" = "list" ] && printf 'Source Name State\\nlocal bk-stale-job running\\n'
exit 0
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(binDir, "arp"),
    `#!/usr/bin/env bash
printf '? (192.168.64.2) at 11:22:33:44:55:66 on bridge101\\n'
`,
    { mode: 0o755 },
  );

  await using proc = Bun.spawn({
    cmd: ["bash", hookPath],
    env: {
      ...bunEnv,
      PATH: `${binDir}:${process.env.PATH}`,
      PRE_EXIT_DHCPD_LEASES_FILE: join(String(dir), "dhcpd_leases"),
      BUILDKITE_BUILD_URL: "https://buildkite.com/bun/bun/builds/12345",
      BUILDKITE_LABEL: ":darwin: 26 aarch64 - test-bun",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const annotations: string[] = [];
  const annotateArgs: string[] = [];
  for (const name of readdirSync(outDir)) {
    const content = readFileSync(join(outDir, name), "utf8");
    if (name.startsWith("annotation.")) annotations.push(content.replaceAll(String(dir), "<dir>"));
    if (name.startsWith("annotate-args.")) annotateArgs.push(content);
  }
  return { exitCode, stdout, stderr, annotations, annotateArgs };
}

t("job timeout posts an annotation", async () => {
  const jobId = `pre-exit-test-${crypto.randomUUID()}`;
  const { exitCode, annotations, annotateArgs } = await runHook({
    BUILDKITE_COMMAND_EXIT_STATUS: "-1",
    BUILDKITE_JOB_ID: jobId,
    BUILDKITE_JOB_CANCELLED: "true",
    BUILDKITE_JOB_TIMED_OUT: "true",
    BUILDKITE_TIMEOUT: "45",
    BUILDKITE_AGENT_NAME: "darwin-sourdough-arm64-tart-26",
  });
  expect(annotations).toHaveLength(1);
  // Pin the whole body: the <details> shell, the heading, the fence, and the
  // fallback text, so a join or quoting regression cannot hide between
  // substring checks.
  expect(annotations[0].replaceAll(jobId, "<job-id>")).toMatchInlineSnapshot(`
    "<details><summary><a><code>job timed out at 45 minutes on darwin-sourdough-arm64-tart-26</code></a> on <a href="https://buildkite.com/bun/bun/builds/12345#<job-id>">:darwin: 26 aarch64 - test-bun</a></summary>

    \`\`\`terminal
    see the job log for output
    \`\`\`

    </details>

    "
  `);
  expect(annotateArgs[0]).toContain("job-timed-out");
  expect(exitCode).toBe(0);
});

t("job timeout on a tart host captures guest logs and VM state", async () => {
  const jobId = `pre-exit-test-${crypto.randomUUID()}`;
  const guestLog = `/tmp/bk-${jobId}.log`;
  // Backtick included: the body renders inside a ```terminal fence, so the
  // hook must escape it.
  writeFileSync(guestLog, "Stopping VM...\nvirtio-net: queue `stalled`\n");
  try {
    const { exitCode, annotations } = await runHook({
      BUILDKITE_COMMAND_EXIT_STATUS: "-1",
      BUILDKITE_JOB_ID: jobId,
      BUILDKITE_JOB_CANCELLED: "true",
      BUILDKITE_JOB_TIMED_OUT: "true",
      BUILDKITE_TIMEOUT: "45",
      BUILDKITE_AGENT_NAME: "darwin-sourdough-arm64-tart-26",
    });
    expect(annotations).toHaveLength(1);
    // Every section in order, newline-separated, backtick escaped; the
    // `Stopping VM...` boot noise is filtered out.
    expect(annotations[0].replaceAll(jobId, "<job-id>")).toMatchInlineSnapshot(`
      "<details><summary><a><code>job timed out at 45 minutes on darwin-sourdough-arm64-tart-26</code></a> on <a href="https://buildkite.com/bun/bun/builds/12345#<job-id>">:darwin: 26 aarch64 - test-bun</a></summary>

      \`\`\`terminal
      bk-<job-id>.log: virtio-net: queue \\\`stalled\\\`
      tart list: Source Name State
      local bk-stale-job running
      <dir>/dhcpd_leases: 11 lines, tail: {
      	name=bk-old-job-0
      	ip_address=192.168.64.2
      	hw_address=1,aa:bb:cc:dd:ee:00
      	lease=0x69875a00
      }
      {
      	name=bk-old-job-1
      	ip_address=192.168.64.3
      	hw_address=1,aa:bb:cc:dd:ee:01
      	lease=0x69875a00
      }
      arp -an: ? (192.168.64.2) at 11:22:33:44:55:66 on bridge101
      \`\`\`

      </details>

      "
    `);
    expect(exitCode).toBe(0);
  } finally {
    rmSync(guestLog, { force: true });
  }
});

t("user/build cancel stays silent", async () => {
  const { exitCode, annotations } = await runHook({
    BUILDKITE_COMMAND_EXIT_STATUS: "-1",
    BUILDKITE_JOB_ID: `pre-exit-test-${crypto.randomUUID()}`,
    BUILDKITE_JOB_CANCELLED: "true",
  });
  expect(annotations).toHaveLength(0);
  expect(exitCode).toBe(0);
});

t("agent-killed exit codes without cancel vars stay silent", async () => {
  for (const status of ["-1", "3221225786"]) {
    const { exitCode, annotations } = await runHook({
      BUILDKITE_COMMAND_EXIT_STATUS: status,
      BUILDKITE_JOB_ID: `pre-exit-test-${crypto.randomUUID()}`,
    });
    expect(annotations).toHaveLength(0);
    expect(exitCode).toBe(0);
  }
});

t("step failure outside the runner still annotates", async () => {
  const jobId = `pre-exit-test-${crypto.randomUUID()}`;
  const { exitCode, annotations, annotateArgs } = await runHook({
    BUILDKITE_COMMAND_EXIT_STATUS: "255",
    BUILDKITE_JOB_ID: jobId,
  });
  expect(annotations).toHaveLength(1);
  expect(annotations[0].replaceAll(jobId, "<job-id>")).toMatchInlineSnapshot(`
    "<details><summary><a><code>step failed outside runner - exit 255</code></a> on <a href="https://buildkite.com/bun/bun/builds/12345#<job-id>">:darwin: 26 aarch64 - test-bun</a></summary>

    \`\`\`terminal
    see the job log for output
    \`\`\`

    </details>

    "
  `);
  expect(annotateArgs[0]).toContain("step-failed-outside-runner");
  expect(exitCode).toBe(0);
});

t("non-timeout failure on a tart host includes guest logs but no VM snapshot", async () => {
  const jobId = `pre-exit-test-${crypto.randomUUID()}`;
  const guestLog = `/tmp/bk-${jobId}.log`;
  writeFileSync(guestLog, "Stopping VM...\nguest never booted\n");
  try {
    const { exitCode, annotations } = await runHook({
      BUILDKITE_COMMAND_EXIT_STATUS: "255",
      BUILDKITE_JOB_ID: jobId,
    });
    expect(annotations).toHaveLength(1);
    const body = annotations[0];
    expect(body).toContain(`bk-${jobId}.log: guest never booted`);
    expect(body).toContain("step failed outside runner - exit 255");
    // The VM/DHCP/arp snapshot is timeout-only: a fast failure's annotation
    // stays as small as it was before #37246.
    expect(body).not.toContain("tart list");
    expect(body).not.toContain("dhcpd_leases");
    expect(body).not.toContain("arp -an");
    expect(exitCode).toBe(0);
  } finally {
    rmSync(guestLog, { force: true });
  }
});

t("timeout after the reporter already annotated stays silent", async () => {
  const { exitCode, annotations } = await runHook(
    {
      BUILDKITE_COMMAND_EXIT_STATUS: "-1",
      BUILDKITE_JOB_ID: `pre-exit-test-${crypto.randomUUID()}`,
      BUILDKITE_JOB_CANCELLED: "true",
      BUILDKITE_JOB_TIMED_OUT: "true",
    },
    { reported: true },
  );
  expect(annotations).toHaveLength(0);
  expect(exitCode).toBe(0);
});

t("successful job exits without touching buildkite-agent", async () => {
  const { exitCode, annotations } = await runHook({
    BUILDKITE_COMMAND_EXIT_STATUS: "0",
    BUILDKITE_JOB_ID: `pre-exit-test-${crypto.randomUUID()}`,
  });
  expect(annotations).toHaveLength(0);
  expect(exitCode).toBe(0);
});

// Keep the hook honest about never failing the job: unknown garbage env still
// exits 0.
t("never exits non-zero even when annotate fails", async () => {
  using dir = tempDir("pre-exit-hook-fail", {});
  const binDir = join(String(dir), "bin");
  mkdirSync(binDir);
  writeFileSync(join(binDir, "buildkite-agent"), `#!/usr/bin/env bash\nexit 1\n`, { mode: 0o755 });
  await using proc = Bun.spawn({
    cmd: ["bash", hookPath],
    env: {
      ...bunEnv,
      PATH: `${binDir}:${process.env.PATH}`,
      BUILDKITE_COMMAND_EXIT_STATUS: "255",
      BUILDKITE_JOB_ID: `pre-exit-test-${crypto.randomUUID()}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("pre-exit: buildkite-agent annotate failed (non-fatal)");
  expect(exitCode).toBe(0);
});
