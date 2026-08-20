// Exercises upload_github_assets in .buildkite/scripts/upload-release.sh with a
// mock `gh` on PATH that keeps a JSON asset list. The point is the two-phase
// stage/swap: a cancel during the long data-transfer window must leave every
// live asset name intact.
import { describe, expect, test } from "bun:test";
import { bunEnv, isLinux, tempDir } from "harness";
import { join, resolve } from "node:path";

const scriptPath = resolve(import.meta.dir, "../../.buildkite/scripts/upload-release.sh");

// The mock `gh` implements just enough of `release view`, `release upload`, and
// `api -X {DELETE,PATCH}` to maintain a [{id,name}] asset list. `MOCK_KILL_ON`
// matches a call's argv and sends SIGTERM to the caller to simulate the
// Buildkite agent cancelling the step mid-call.
const mockGh = `#!/usr/bin/env bash
set -euo pipefail
echo "gh $*" >> "$MOCK_CALLS"
if [ -n "\${MOCK_KILL_ON:-}" ] && [[ "$*" =~ \${MOCK_KILL_ON} ]]; then
  kill -TERM "$PPID" 2>/dev/null; exit 143
fi
if [ -n "\${MOCK_5XX_ONCE:-}" ] && [[ "$*" =~ \${MOCK_5XX_ONCE} ]] && [ ! -f "$MOCK_STATE.5xx-fired" ]; then
  : > "$MOCK_STATE.5xx-fired"; echo "HTTP 502" >&2; exit 1
fi
state="$MOCK_STATE"
case "$1 $2" in
  "release view")
    bun -e 'for (const a of JSON.parse(require("fs").readFileSync(process.env.MOCK_STATE,"utf8"))) console.log("https://api.github.com/repos/o/r/releases/assets/"+a.id, a.name)'
    ;;
  "release upload")
    shift 2; shift # tag
    files=()
    while [ $# -gt 0 ]; do case "$1" in --clobber|--repo) [ "$1" = --repo ] && shift ;; *) files+=("$1") ;; esac; shift; done
    MOCK_FILES="\${files[*]}" bun -e '
      const fs=require("fs"),p=require("path");
      const s=JSON.parse(fs.readFileSync(process.env.MOCK_STATE,"utf8"));
      let next=Math.max(0,...s.map(a=>a.id))+1;
      for (const f of process.env.MOCK_FILES.split(" ")) {
        const n=p.basename(f);
        const i=s.findIndex(a=>a.name===n);
        if (i>=0) s.splice(i,1);
        s.push({id:next++,name:n});
      }
      fs.writeFileSync(process.env.MOCK_STATE,JSON.stringify(s));'
    ;;
  "api -X")
    method="$3"; url="$4"; id="\${url##*/}"
    if [ "$method" = DELETE ]; then
      MOCK_ID="$id" bun -e '
        const fs=require("fs");
        const s=JSON.parse(fs.readFileSync(process.env.MOCK_STATE,"utf8")).filter(a=>String(a.id)!==process.env.MOCK_ID);
        fs.writeFileSync(process.env.MOCK_STATE,JSON.stringify(s));'
    else
      newname=""; for a in "$@"; do [[ "$a" == name=* ]] && newname="\${a#name=}"; done
      MOCK_ID="$id" MOCK_NAME="$newname" bun -e '
        const fs=require("fs");
        const s=JSON.parse(fs.readFileSync(process.env.MOCK_STATE,"utf8"));
        for (const a of s) if (String(a.id)===process.env.MOCK_ID) a.name=process.env.MOCK_NAME;
        fs.writeFileSync(process.env.MOCK_STATE,JSON.stringify(s));
        console.log(process.env.MOCK_NAME);'
    fi
    ;;
  *) echo "mock gh: unhandled: $*" >&2; exit 1 ;;
esac
`;

type Asset = { id: number; name: string };

async function run(opts: { initialAssets: Asset[]; killOn?: string; fail5xxOnce?: string }) {
  using dir = tempDir("upload-release-assets", {
    "bin/gh": mockGh,
    "state.json": JSON.stringify(opts.initialAssets),
    "calls.log": "",
    "a.zip": "a",
    "b.zip": "b",
    "c.zip": "c",
    // Source just the functions under test, then invoke. Sourcing the whole
    // script would trip assert_main / assert_canary.
    "run.sh": `set -eo pipefail
source <(sed -n '/^function run_command/,/^}/p; /^function release_tag/,/^}/p; /^function list_release_assets/,/^}/p; /^function gh_api_retry/,/^}/p; /^function upload_github_assets/,/^}/p' "$SCRIPT")
upload_github_assets canary a.zip b.zip c.zip
`,
  });
  const cwd = String(dir);
  await Bun.spawn({ cmd: ["chmod", "+x", join(cwd, "bin/gh")] }).exited;

  await using proc = Bun.spawn({
    cmd: ["bash", "run.sh"],
    cwd,
    env: {
      ...bunEnv,
      PATH: `${join(cwd, "bin")}:${process.env.PATH}`,
      SCRIPT: scriptPath,
      MOCK_STATE: join(cwd, "state.json"),
      MOCK_CALLS: join(cwd, "calls.log"),
      BUILDKITE_REPO: "https://github.com/o/r.git",
      BUILDKITE_BUILD_NUMBER: "999",
      ...(opts.killOn ? { MOCK_KILL_ON: opts.killOn } : {}),
      ...(opts.fail5xxOnce ? { MOCK_5XX_ONCE: opts.fail5xxOnce } : {}),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const assets: Asset[] = JSON.parse(await Bun.file(join(cwd, "state.json")).text());
  const calls = (await Bun.file(join(cwd, "calls.log")).text()).trim().split("\n");
  return { exitCode, assets, calls, stdout, stderr };
}

const live = (assets: Asset[]) => assets.filter(a => !a.name.startsWith("incoming-"));
const staged = (assets: Asset[]) => assets.filter(a => a.name.startsWith("incoming-"));

// Linux only: the :rocket: step runs on the debian-13 aarch64 host, and
// upload_github_assets uses bash 4+ associative arrays which macOS /bin/bash
// (3.2) does not have.
describe.concurrent.skipIf(!isLinux)("upload_github_assets", () => {
  const initial: Asset[] = [
    { id: 1, name: "a.zip" },
    { id: 2, name: "b.zip" },
    { id: 3, name: "c.zip" },
  ];

  test("full run swaps every asset to a new id under its live name", async () => {
    const r = await run({ initialAssets: initial });
    expect(r.stderr).not.toContain("error:");
    expect(r.exitCode).toBe(0);
    expect(
      live(r.assets)
        .map(a => a.name)
        .sort(),
    ).toEqual(["a.zip", "b.zip", "c.zip"]);
    expect(live(r.assets).every(a => a.id > 3)).toBe(true);
    expect(staged(r.assets)).toEqual([]);
  });

  test("cancel during the staging upload leaves every live name intact", async () => {
    const r = await run({ initialAssets: initial, killOn: "release upload canary" });
    expect(r.exitCode).not.toBe(0);
    // The invariant this PR exists for: the old assets are untouched.
    expect(live(r.assets)).toEqual(initial);
  });

  test("cancel between DELETE and PATCH loses at most the one asset mid-swap", async () => {
    const r = await run({ initialAssets: initial, killOn: "PATCH .*assets/4 " });
    expect(r.exitCode).not.toBe(0);
    const liveNames = live(r.assets)
      .map(a => a.name)
      .sort();
    expect(liveNames).toEqual(["b.zip", "c.zip"]);
    // a.zip's data is still present under its staged name.
    expect(staged(r.assets).some(a => a.name === "incoming-999-a.zip")).toBe(true);
  });

  test("transient 5xx on PATCH is retried instead of aborting mid-swap", async () => {
    const r = await run({ initialAssets: initial, fail5xxOnce: "PATCH .*assets/4 " });
    expect(r.exitCode).toBe(0);
    expect(
      live(r.assets)
        .map(a => a.name)
        .sort(),
    ).toEqual(["a.zip", "b.zip", "c.zip"]);
    expect(staged(r.assets)).toEqual([]);
    expect(r.stderr).toContain("retrying");
  });

  test("release already missing an asset is healed", async () => {
    const r = await run({
      initialAssets: [
        { id: 1, name: "a.zip" },
        { id: 3, name: "c.zip" },
      ],
    });
    expect(r.exitCode).toBe(0);
    expect(
      live(r.assets)
        .map(a => a.name)
        .sort(),
    ).toEqual(["a.zip", "b.zip", "c.zip"]);
  });

  test("stale incoming-* from a previous interrupted run is swept before staging", async () => {
    const r = await run({
      initialAssets: [...initial, { id: 100, name: "incoming-777-a.zip" }, { id: 101, name: "incoming-777-c.zip" }],
    });
    expect(r.exitCode).toBe(0);
    expect(
      live(r.assets)
        .map(a => a.name)
        .sort(),
    ).toEqual(["a.zip", "b.zip", "c.zip"]);
    expect(staged(r.assets)).toEqual([]);
    // The sweep hit the two stale ids before the new upload.
    expect(r.calls.some(c => c.includes("DELETE") && c.endsWith("/100"))).toBe(true);
    expect(r.calls.some(c => c.includes("DELETE") && c.endsWith("/101"))).toBe(true);
  });

  test("staged filenames keep the .zip extension so gh sets application/zip", async () => {
    const r = await run({ initialAssets: initial });
    const upload = r.calls.find(c => c.startsWith("gh release upload"))!;
    for (const f of ["a.zip", "b.zip", "c.zip"]) {
      expect(upload).toContain(`incoming-999-${f}`);
    }
    expect(upload.match(/incoming-999-[abc]\.zip/g)?.length).toBe(3);
  });
});
