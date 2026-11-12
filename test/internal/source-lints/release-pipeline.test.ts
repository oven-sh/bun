/**
 * Runs the scripts behind a release build against stand-ins for the programs they call.
 */
import { describe, expect, test } from "bun:test";
import { isLinux, tempDir } from "harness";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const commit = "0123456789abcdef0123456789abcdef01234567";
const otherCommit = "fedcba9876543210fedcba9876543210fedcba98";
const repo = "oven-sh/bun";
const updaterRepo = "oven-sh/bun-releases-for-updater";

const releaseBuild = {
  BUILDKITE: "true",
  BUILDKITE_BRANCH: "release/bun-v1.10.0",
  BUILDKITE_COMMAND: "node .buildkite/ci.mjs",
  BUILDKITE_COMMIT: commit,
  BUILDKITE_MESSAGE: "Bump",
  BUILDKITE_PIPELINE_DEFAULT_BRANCH: "main",
  BUILDKITE_PULL_REQUEST: "false",
  BUILDKITE_REPO: `https://github.com/${repo}.git`,
  BUILDKITE_SOURCE: "ui",
  STUB_TAGS: "bun-v1.2.0 bun-v1.9.10 bun-v1.9.9 bun-v9-beta",
  STUB_UPDATER_TAGS: "bun-v1.9.10",
  STUB_HEAD: commit,
};
type Env = Record<string, string>;

const log = `echo "$(basename "$0") $*" >> "$STUB_DIR/calls.txt"`;

const git = `#!/bin/bash
[ "$*" != "rev-parse HEAD" ] || { echo ${commit}; exit 0; }
[ "$1 $2" == "ls-remote --refs" ] || exit 1
[ -z "$STUB_GIT_ERROR" ] || { echo "$STUB_GIT_ERROR" >&2; exit 128; }
case "$3 $4" in
  *"/bun refs/tags/bun-v*") tags="$STUB_TAGS" ;;
  *"/bun-releases-for-updater refs/tags/bun-v*") tags="$STUB_UPDATER_TAGS" ;;
  *"/bun refs/heads/$BUILDKITE_BRANCH") [ -z "$STUB_HEAD" ] || printf '%s\\t%s\\n' "$STUB_HEAD" "$4"; exit 0 ;;
  *) exit 1 ;;
esac
for tag in $tags; do printf '${otherCommit}\\trefs/tags/%s\\n' "$tag"; done
`;

function sandbox(programs: Record<string, string>, files: Record<string, string> = {}) {
  const dir = tempDir("release-pipeline", {
    "package.json": JSON.stringify({ version: "1.10.0" }),
    "calls.txt": "",
    ...files,
    bin: { git, ...programs },
  });
  const path = String(dir);
  for (const program of readdirSync(join(path, "bin"))) chmodSync(join(path, "bin", program), 0o755);
  return {
    path,
    read: (file: string) => readFileSync(join(path, file), "utf8"),
    calls: () => readFileSync(join(path, "calls.txt"), "utf8").split("\n").filter(Boolean),
    async run(cmd: string[], env: Env) {
      await using proc = Bun.spawn({
        cmd,
        cwd: path,
        env: {
          PATH: `${join(path, "bin")}:${env.STUB_PATH ?? process.env.PATH}`,
          HOME: path,
          TMPDIR: path,
          STUB_DIR: path,
          BUN_DEBUG_QUIET_LOGS: "1",
          ...env,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    },
    [Symbol.dispose]: () => dir[Symbol.dispose](),
  };
}

describe.skipIf(!isLinux)("check-release.ts", () => {
  const check = async (env: Env) => {
    using box = sandbox({});
    const script = `
      import { checkRelease } from ${JSON.stringify(join(repoRoot, "scripts", "check-release.ts"))};
      console.log(JSON.stringify(checkRelease()));`;
    return await box.run([process.execPath, "-e", script], { ...releaseBuild, ...env });
  };

  test.concurrent.each([commit, "HEAD"])("accepts a build of %s", async BUILDKITE_COMMIT => {
    expect(await check({ BUILDKITE_COMMIT })).toEqual({
      stdout: `${JSON.stringify({ version: "1.10.0", commit, previousTag: "bun-v1.9.10" })}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent.each<[string, Env, string]>([
    ["another branch", { BUILDKITE_BRANCH: "main" }, `"main" is not a release branch (release/bun-vX.Y.Z)`],
    ["a partial version", { BUILDKITE_BRANCH: "release/bun-v1.10" }, "is not a release branch"],
    ["a suffix", { BUILDKITE_BRANCH: "release/bun-v1.10.0-rc" }, "is not a release branch"],
    ["a prefix", { BUILDKITE_BRANCH: "someone:release/bun-v1.10.0" }, "is not a release branch"],
    ["a pull request", { BUILDKITE_PULL_REQUEST: "123" }, "is not a release branch"],
    ["a fork", { BUILDKITE_PULL_REQUEST_REPO: "https://github.com/someone/bun.git" }, "is not a release branch"],
    [
      "another version in package.json",
      { BUILDKITE_BRANCH: "release/bun-v1.10.1" },
      "package.json has version 1.10.0, but release/bun-v1.10.1 releases 1.10.1",
    ],
    [
      "a published version",
      { STUB_TAGS: "bun-v1.9.10 bun-v1.10.0" },
      `1.10.0 is not newer than 1.10.0, which ${repo} has already published`,
    ],
    [
      "a version published for the updater",
      { STUB_UPDATER_TAGS: "bun-v1.10.0" },
      `1.10.0 is not newer than 1.10.0, which ${updaterRepo} has already published`,
    ],
    ["an older patch", { STUB_TAGS: "bun-v1.10.1" }, "1.10.0 is not newer than 1.10.1"],
    ["an older major", { STUB_TAGS: "bun-v2.0.0 bun-v1.0.0" }, "1.10.0 is not newer than 2.0.0"],
    ["no tags", { STUB_TAGS: "" }, `${repo} has no bun-v* tags`],
    [
      "a branch that moved",
      { STUB_HEAD: otherCommit },
      `This build is of ${commit}, but release/bun-v1.10.0 is at ${otherCommit}.`,
    ],
    ["a missing branch", { STUB_HEAD: "" }, `${repo} has no branch named release/bun-v1.10.0`],
    ["an unreachable remote", { STUB_GIT_ERROR: "unable to access" }, "unable to access"],
  ])("refuses %s", async (_, env, message) => {
    const { stdout, stderr, exitCode } = await check(env);
    expect(stderr).toContain(message);
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });
});

describe.skipIf(!isLinux)("ci.ts", () => {
  interface Step {
    key: string;
    command?: string | string[];
    depends_on?: string[];
    agents?: { queue?: string };
    steps?: Step[];
  }

  async function generate(env: Env, ...args: string[]) {
    using box = sandbox(
      {
        "buildkite-agent": `#!/bin/bash
case "$1 $2" in
  "meta-data get") name="STUB_OPTION_\${3//-/_}"; echo "\${!name}" ;;
  "secret get") exit 1 ;;
esac`,
      },
      {
        ".buildkite/.keep": "",
        "preload.ts": `
          globalThis.fetch = (() => Promise.reject(new Error("offline"))) as any;
          Bun.plugin({
            name: "images",
            setup: build => void build.onLoad({ filter: /scripts\\/ci-image\\.ts$/ }, () => ({
              loader: "js",
              contents: "export const getImageState = async () => process.env.STUB_IMAGE_STATE ?? 'available';",
            })),
          });`,
      },
    );
    const cmd = [process.execPath, "--preload", "./preload.ts", join(repoRoot, ".buildkite", "ci.ts"), ...args];
    const { stderr, exitCode } = await box.run(cmd, { ...releaseBuild, ...env });
    if (!existsSync(join(box.path, ".buildkite", "ci.json"))) {
      return { stderr, exitCode, steps: [] as Step[], summary: undefined };
    }
    const { priority, steps: groups } = JSON.parse(box.read(".buildkite/ci.json")) as {
      priority: number;
      steps: Step[];
    };
    const steps = groups.flatMap(step => step.steps ?? [step]);
    const builds = steps.filter(({ key }) => key.endsWith("-build-bun"));
    const command = (key: string) => [steps.find(step => step.key === key)?.command ?? []].flat().join("\n");
    const summary = {
      priority,
      asksOptions: steps.some(({ key }) => key === "options"),
      canary: [...new Set(builds.map(({ key }) => !command(key).includes("--canary=off")))],
      otherProfiles: steps.some(({ key }) => /asan|hardened/.test(key)),
      everyMac: groups.some(({ key }) => key === "darwin-aarch64-14"),
      enforcesSize: /binary-size/.test(command("binary-size")) && !command("binary-size").includes("--no-fail"),
      signs: steps.map(({ key }) => key).filter(key => key.endsWith("-sign")),
      uploads: command("release").split(" ")[2],
    };
    return { stderr, exitCode, steps, summary };
  }

  const shipping = { asksOptions: false, otherProfiles: false, everyMac: true, enforcesSize: false };
  const releasePush = { ...shipping, priority: 3, canary: [true], signs: [], uploads: undefined };
  const mainPush = { ...shipping, priority: 2, canary: [true], signs: [], uploads: "canary" };
  const pullRequest = {
    asksOptions: false,
    otherProfiles: true,
    everyMac: false,
    enforcesSize: true,
    priority: 0,
    canary: [true],
    signs: [],
    uploads: undefined,
  };
  const release = {
    ...shipping,
    priority: 3,
    canary: [false],
    signs: ["windows-sign", "darwin-sign"],
    uploads: "draft",
  };
  const main = { BUILDKITE_BRANCH: "main", BUILDKITE_SOURCE: "webhook" };

  test.concurrent.each<[string, Env, object, ...string[]]>([
    ["New Build on a release branch", {}, release],
    ["New Build on a release branch, [skip ci]", { BUILDKITE_MESSAGE: "Bump [skip ci] [skip builds]" }, release],
    ["a push to a release branch", { BUILDKITE_SOURCE: "webhook" }, releasePush],
    ["a push of a published commit", { BUILDKITE_SOURCE: "webhook", STUB_TAGS: "bun-v1.10.0" }, releasePush],
    ["an API build of a release branch", { BUILDKITE_SOURCE: "api" }, releasePush],
    ["Rebuild on a release branch", { BUILDKITE_REBUILT_FROM_BUILD_ID: "1" }, releasePush],
    ["a push to main", main, mainPush],
    ["a push to main, [release]", { ...main, BUILDKITE_MESSAGE: "Bump [release]" }, mainPush],
    ["RELEASE=1 on main", { ...main, RELEASE: "1" }, { ...mainPush, canary: [false], uploads: undefined }],
    ["New Build on main, canary", { BUILDKITE_BRANCH: "main", STUB_OPTION_canary: "true" }, mainPush, "--apply"],
    [
      "New Build on main, not canary",
      { BUILDKITE_BRANCH: "main", STUB_OPTION_canary: "false" },
      { ...mainPush, canary: [false], uploads: undefined },
      "--apply",
    ],
    [
      "a pull request from a release branch",
      { BUILDKITE_SOURCE: "webhook", BUILDKITE_PULL_REQUEST: "123" },
      pullRequest,
    ],
    [
      "a fork's branch with the name of a release branch",
      {
        BUILDKITE_SOURCE: "webhook",
        BUILDKITE_PULL_REQUEST: "123",
        BUILDKITE_PULL_REQUEST_REPO: "https://github.com/someone/bun.git",
      },
      { ...pullRequest, priority: -1 },
    ],
  ])("%s", async (_, env, expected, ...args) => {
    const { summary, exitCode } = await generate(env, ...args);
    expect(summary).toEqual(expected as typeof summary);
    expect(exitCode).toBe(0);
  });

  test.concurrent.each(["main", "release/notes"])("New Build on %s asks for options", async branch => {
    const { steps } = await generate({ BUILDKITE_BRANCH: branch });
    expect(steps.map(({ key }) => key)).toEqual(["options", "options-apply"]);
  });

  test.concurrent("a release that fails its check has no steps", async () => {
    const { stderr, steps, exitCode } = await generate({ STUB_HEAD: otherCommit });
    expect(stderr).toContain("Start a new build of the branch.");
    expect({ steps, exitCode }).toEqual({ steps: [], exitCode: 1 });
  });

  test.concurrent("the drafts wait for every build and both signing steps", async () => {
    const { steps } = await generate({ STUB_IMAGE_STATE: "missing" });
    const step = (key: string) => steps.find(step => step.key === key)!;
    const builds = steps.map(({ key }) => key).filter(key => key.endsWith("-build-bun"));

    expect(builds).toHaveLength(12);
    expect(step("release").depends_on).toEqual([...builds, "windows-sign", "darwin-sign"]);
    expect(step("windows-sign").depends_on).toEqual([
      "windows-x64-build-bun",
      "windows-aarch64-build-bun",
      expect.stringMatching(/^windows-x64.*-image$/),
    ]);
    expect(step("darwin-sign")).toMatchObject({
      agents: { queue: "release-darwin" },
      depends_on: ["darwin-aarch64-build-bun", "darwin-x64-build-bun"],
      command:
        "node .buildkite/scripts/sign-darwin-artifacts.ts" +
        " bun-darwin-aarch64-profile.zip=darwin-aarch64-build-bun bun-darwin-aarch64.zip=darwin-aarch64-build-bun" +
        " bun-darwin-x64-profile.zip=darwin-x64-build-bun bun-darwin-x64.zip=darwin-x64-build-bun",
    });
  });
});

const hasTools = isLinux && ["cmake", "unzip"].every(tool => Bun.which(tool));

/** An artifact holds one file, $STUB_BINARY followed by the key of the step it came from. */
const agent = `#!/bin/bash
${log}
case "$1 $2" in
  "secret get") [ "$3" != "$STUB_MISSING_SECRET" ] || exit 1; name="STUB_SECRET_$3"; echo "\${!name:-secret}" ;;
  "artifact download")
    [ "$3" != "$STUB_MISSING_ARTIFACT" ] || exit 1
    zip="$PWD/$3"; directory="\${3%.zip}"; binary=bun
    [[ "$directory" != *-profile ]] || binary=bun-profile
    cd "$(mktemp -d)" && mkdir "$directory"
    echo "$STUB_BINARY\${6:-any}" > "$directory/$binary" && chmod +x "$directory/$binary"
    cmake -E tar cf "$zip" --format=zip "$directory" ;;
  "annotate "*) cat > "$STUB_DIR/annotation.md" ;;
  "redactor add") cat > "$STUB_DIR/redacted.txt" ;;
esac`;

describe.skipIf(!hasTools)("upload-release.ts", () => {
  interface Release {
    id: number;
    draft: boolean;
    tag_name: string;
    name: string;
    target_commitish?: string;
    body?: string;
    assets?: { name: string; digest: string }[];
  }
  type Releases = Record<string, Release[]>;

  const gh = `
    import { readFileSync, writeFileSync } from "node:fs";
    import { parseArgs } from "node:util";
    const text = { type: "string" }, flag = { type: "boolean" };
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: { repo: text, title: text, target: text, notes: text, draft: flag, clobber: flag },
    });
    const { GH_TOKEN, STUB_DIR, STUB_CORRUPT, STUB_EXTRA, STUB_DUPLICATE, STUB_FAIL_CREATE } = process.env;
    if (GH_TOKEN !== "token") process.exit(4);
    if (positionals[1] !== "create") process.exit(0);

    const [, , tag_name, ...files] = positionals;
    const assets = files.map(name => ({ name, digest: "sha256:" + Bun.SHA256.hash(readFileSync(name), "hex") }));
    if (STUB_CORRUPT === values.repo) assets[3].digest = "sha256:0";
    if (STUB_EXTRA === values.repo) assets.push({ name: "extra.zip", digest: null });
    if (STUB_FAIL_CREATE === values.repo) {
      assets.length = 3;
      console.error("upload failed");
      process.exitCode = 1;
    }
    const state = JSON.parse(readFileSync(STUB_DIR + "/releases.json", "utf8"));
    for (const id of STUB_DUPLICATE === values.repo ? [100, 101] : [100]) {
      state[values.repo].push({
        id, tag_name, assets, draft: !!values.draft, name: values.title, body: values.notes,
        target_commitish: values.target ?? "master",
      });
    }
    writeFileSync(STUB_DIR + "/releases.json", JSON.stringify(state));`;

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 1024,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "pkcs1", format: "pem" },
  });

  /** What matters is on the second page of every list but that of a draft's files. */
  const api = `
    import { createVerify } from "node:crypto";
    import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
    const { STUB_DIR, STUB_FAIL_RENAME } = process.env;
    const user = login => ({ author: { login, type: "User" } });

    globalThis.fetch = async (url, { method, headers, body } = {}) => {
      const { hostname, pathname, searchParams } = new URL(url);
      if (hostname === "github.com") return { url: url.replace("latest", "tag/v1.2.3") };
      if (hostname === "discord.test") {
        const [{ title, description }] = JSON.parse(body).embeds;
        appendFileSync(STUB_DIR + "/calls.txt", "discord " + JSON.stringify({ title, description }) + "\\n");
        return new Response(null, { status: Number(process.env.STUB_DISCORD_STATUS ?? 204) });
      }

      const token = headers.Authorization.slice("Bearer ".length);
      if (method === "POST" && pathname === "/app/installations/177437987/access_tokens") {
        const [header, payload, signature] = token.split(".");
        const { iss, iat, exp } = JSON.parse(Buffer.from(payload, "base64url"));
        const now = Date.now() / 1000;
        const signed = createVerify("RSA-SHA256")
          .update(header + "." + payload)
          .verify(${JSON.stringify(publicKey)}, signature, "base64url");
        const valid = signed && iss === "Iv23li0GlmKSYj59x7e3" && iat < now && now < exp && exp < now + 600;
        return valid ? Response.json({ token: "token" }) : new Response("bad JWT", { status: 400 });
      }
      if (token !== "token") return new Response("bad token", { status: 400 });

      const page = (list, filler) => {
        const [size, number] = [Number(searchParams.get("per_page")), Number(searchParams.get("page"))];
        return [...(filler ? Array(size).fill(filler) : []), ...list].slice((number - 1) * size, number * size);
      };
      const [, repo, kind, id, assets] = /^.repos.([^/]+.[^/]+).(\\w+).?([^/]+)?(.assets)?$/.exec(pathname);
      if (kind === "compare") {
        if (id !== "bun-v1.9.10...${commit}") return new Response("no such range", { status: 404 });
        const bot = { author: { login: "app[bot]", type: "Bot" } };
        return Response.json({ commits: page([user("Bob"), { author: null }, user("alice"), bot], user("zed")) });
      }

      const state = JSON.parse(readFileSync(STUB_DIR + "/releases.json", "utf8"));
      const release = state[repo].find(release => release.id === Number(id));
      if (method === "GET") {
        return Response.json(assets ? page(release.assets) : page(state[repo], { id: 0, draft: false, tag_name: "old" }));
      }
      if (method === "DELETE") {
        state[repo] = state[repo].filter(other => other !== release);
      } else {
        if (STUB_FAIL_RENAME === repo) return new Response("rename failed", { status: 422 });
        Object.assign(release, { tag_name: "untagged-1" }, JSON.parse(body));
      }
      writeFileSync(STUB_DIR + "/releases.json", JSON.stringify(state));
      return method === "DELETE"
        ? new Response(null, { status: 204 })
        : Response.json({ ...release, html_url: "https://github.com/" + repo + "/releases/" + id });
    };`;

  const untouched: Release[] = [
    { id: 1, draft: false, tag_name: "bun-v1.10.0", name: "published after the check" },
    { id: 2, draft: true, tag_name: "bun-v1.10.01", name: "another draft" },
  ];
  const before: Releases = {
    [repo]: [
      ...untouched,
      { id: 3, draft: true, tag_name: "bun-v1.10.0", name: "Bun v1.10.0" },
      { id: 4, draft: true, tag_name: "bun-v1.10.0", name: "Bun v1.10.0 (incomplete, do not publish)" },
    ],
    [updaterRepo]: [...untouched, { id: 5, draft: true, tag_name: "bun-v1.10.0", name: "Bun v1.10.0" }],
  };
  const programs = {
    "gh": `#!/bin/bash\n${log}\nexec "${process.execPath}" "$STUB_DIR/gh.mjs" "$@"`,
    "aws": `#!/bin/bash\n${log}\n[ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ] && [ -z "$STUB_FAIL_S3" ]`,
    "sentry-cli": `#!/bin/bash\n${log}\n[ -n "$SENTRY_AUTH_TOKEN" ] && [ -n "$SENTRY_ORG" ] && [ -n "$SENTRY_PROJECT" ]`,
  };

  async function upload(kind: string, env: Env = {}, installed: Env = programs) {
    using box = sandbox(
      { "buildkite-agent": agent, ...installed },
      { "gh.mjs": gh, "api.mjs": api, "releases.json": JSON.stringify(before), "redacted.txt": "" },
    );
    const script = join(repoRoot, ".buildkite", "scripts", "upload-release.ts");
    const result = await box.run([process.execPath, "--preload", "./api.mjs", script, kind], {
      ...releaseBuild,
      STUB_SECRET_GITHUB_APP_BUN_RELEASE_UPLOAD_PRIVATE_KEY_BASE64: btoa(privateKey),
      STUB_SECRET_BUN_ANNOUNCE_CANARY_WEBHOOK_URL: "https://discord.test/webhook",
      STUB_SECRET_AWS_ENDPOINT: "https://s3.test",
      STUB_SECRET_AWS_BUCKET: "bucket",
      ...env,
    });
    const zips = readdirSync(box.path).filter(file => file.endsWith(".zip"));
    const unzip = (...args: string[]) => Bun.spawnSync(["unzip", ...args], { cwd: box.path }).stdout.toString();
    return {
      ...result,
      releases: JSON.parse(box.read("releases.json")) as Releases,
      calls: box.calls(),
      redacted: box.read("redacted.txt"),
      annotation: existsSync(join(box.path, "annotation.md")) ? box.read("annotation.md") : undefined,
      origins:
        result.exitCode === 0
          ? Object.fromEntries(zips.map(zip => [zip, unzip("-p", zip, `${zip.slice(0, -4)}/*`).trim()]))
          : {},
    };
  }

  const titles = (releases: Releases) =>
    [repo, updaterRepo].map(name => releases[name].slice(untouched.length).map(release => release.name));
  const incomplete = "Bun v1.10.0 (incomplete, do not publish)";

  const targets = [
    ...["darwin-aarch64", "darwin-x64", "darwin-x64-baseline"],
    ...["freebsd-aarch64", "freebsd-x64", "freebsd-x64-baseline"],
    ...["linux-aarch64", "linux-x64", "linux-x64-baseline"],
    ...["linux-aarch64-android", "linux-x64-android", "linux-x64-android-baseline"],
    ...["linux-aarch64-musl", "linux-x64-musl", "linux-x64-musl-baseline"],
    ...["windows-aarch64", "windows-x64", "windows-x64-baseline"],
  ];
  const files = targets.flatMap(target => [`bun-${target}.zip`, `bun-${target}-profile.zip`]).sort();

  test.concurrent("draft replaces the drafts of the version", async () => {
    const { releases, origins, redacted, annotation, exitCode } = await upload("draft");

    expect(redacted).toBe("token");

    expect(origins).toEqual(
      Object.fromEntries(
        files.map(file => [file, /^bun-(darwin|windows)/.exec(file)?.[1].concat("-sign") ?? "any"] as const),
      ),
    );
    for (const [name, target_commitish] of [
      [repo, commit],
      [updaterRepo, "master"],
    ]) {
      const [published, other, draft, ...rest] = releases[name];
      expect([published, other, ...rest]).toEqual(untouched);
      expect(draft).toMatchObject({
        id: 100,
        draft: true,
        tag_name: "bun-v1.10.0",
        name: "Bun v1.10.0",
        target_commitish,
      });
      expect(draft.assets!.map(asset => asset.name).sort()).toEqual(files);
    }
    expect(releases[updaterRepo][2].body).toBe("bunbunbun");
    expect(releases[repo][2].body).toMatchInlineSnapshot(`
      "To install Bun v1.10.0
      \`\`\`bash
      curl -fsSL https://bun.com/install | bash
      # or you can use npm
      # npm install -g bun
      \`\`\`

      Windows:
      \`\`\`bash
      powershell -c "irm bun.com/install.ps1|iex"
      \`\`\`

      To upgrade to Bun v1.10.0:
      \`\`\`bash
      bun upgrade
      \`\`\`

      ### [Read Bun v1.10.0's release notes on Bun's blog](https://bun.com/blog/bun-v1.10.0)

      ### Thanks to 3 contributors!

      - [@alice](https://github.com/alice)
      - [@Bob](https://github.com/Bob)
      - [@zed](https://github.com/zed)
      "
    `);
    expect(annotation).toMatchInlineSnapshot(`
      "The drafts of Bun v1.10.0 are ready. Check the tests of this build, then publish them in this order:

      1. [oven-sh/bun](https://github.com/oven-sh/bun/releases/100)
      2. [oven-sh/bun-releases-for-updater](https://github.com/oven-sh/bun-releases-for-updater/releases/100)
      "
    `);
    expect(exitCode).toBe(0);
  });

  test.concurrent.each<[string, Env]>([
    ["the branch moved", { STUB_HEAD: otherCommit }],
    ["the version is published", { STUB_TAGS: "bun-v1.10.0" }],
    ["a file is missing", { STUB_MISSING_ARTIFACT: "bun-darwin-x64.zip" }],
    ["the notes cannot be written", { STUB_TAGS: "bun-v1.9.9" }],
  ])("draft changes nothing when %s", async (_, env) => {
    const { releases, annotation, exitCode } = await upload("draft", env);
    expect({ releases, annotation, exitCode }).toEqual({ releases: before, annotation: undefined, exitCode: 1 });
  });

  const both = [[incomplete], [incomplete]];
  test.concurrent.each<[string, Env, string[][], string]>([
    ["an upload fails", { STUB_FAIL_CREATE: repo }, [[incomplete], []], "upload failed"],
    ["an upload for the updater fails", { STUB_FAIL_CREATE: updaterRepo }, both, "upload failed"],
    ["a file differs", { STUB_CORRUPT: repo }, both, `${repo} differs from this build in: bun-darwin-x64-profile.zip`],
    ["a file for the updater differs", { STUB_CORRUPT: updaterRepo }, both, `${updaterRepo} differs from this build`],
    ["there is a file too many", { STUB_EXTRA: repo }, both, `${repo} differs from this build in: extra.zip`],
    ["another draft appears", { STUB_DUPLICATE: repo }, [[incomplete, incomplete], [incomplete]], "found: 100, 101"],
    ["the updater's draft cannot be renamed", { STUB_FAIL_RENAME: updaterRepo }, both, "releases/100: 422"],
  ])("draft leaves both drafts incomplete when %s", async (_, env, expected, message) => {
    const { releases, annotation, stderr, exitCode } = await upload("draft", env);
    expect(stderr).toContain(message);
    expect({ titles: titles(releases), annotation, exitCode }).toEqual({
      titles: expected,
      annotation: undefined,
      exitCode: 1,
    });
  });

  const main = { BUILDKITE_BRANCH: "main", BUILDKITE_SOURCE: "webhook" };
  /** The calls after the downloads, with the lists of files folded. */
  const published = (calls: string[]) => [
    ...new Set(
      calls
        .slice(calls.findLastIndex(call => call.includes("artifact download")) + 1)
        .map(call => call.replaceAll(/bun-[\w-]+\.zip( bun-[\w-]+\.zip)*/g, "<zip>")),
    ),
  ];

  test.concurrent("canary uploads the builds of main", async () => {
    const { calls, origins, releases, exitCode } = await upload("canary", main);
    expect(origins).toEqual(Object.fromEntries(files.map(file => [file, "any"])));
    expect(calls).toContain("buildkite-agent secret get AWS_BUCKET --skip-redaction");
    expect(
      calls
        .find(call => call.startsWith("gh release upload"))!
        .match(/\S+\.zip/g)!
        .sort(),
    ).toEqual(files);
    expect(calls.filter(call => call.startsWith("aws "))).toHaveLength(files.length * 2);
    expect(published(calls).join("\n")).toMatchInlineSnapshot(`
      "gh release upload canary <zip> --clobber --repo oven-sh/bun
      gh release edit canary --repo oven-sh/bun --notes This release of Bun corresponds to the commit: 0123456789abcdef0123456789abcdef01234567
      sentry-cli releases new 0123456789abcdef0123456789abcdef01234567-canary --finalize
      sentry-cli releases set-commits 0123456789abcdef0123456789abcdef01234567-canary --auto --ignore-missing
      sentry-cli deploys new --env=canary --release=0123456789abcdef0123456789abcdef01234567-canary
      buildkite-agent secret get BUN_ANNOUNCE_CANARY_WEBHOOK_URL
      discord {"title":"New Bun Canary now available","description":"A new canary build of Bun has been automatically uploaded ([0123456](https://github.com/oven-sh/bun/commit/0123456789abcdef0123456789abcdef01234567)). To upgrade, run:\\n\\n\`\`\`shell\\nbun upgrade --canary\\n\`\`\`\\nCommit: \`0123456789abcdef0123456789abcdef01234567\`"}
      aws --endpoint-url=https://s3.test s3 cp <zip> s3://bucket/releases/0123456789abcdef0123456789abcdef01234567-canary/<zip>
      aws --endpoint-url=https://s3.test s3 cp <zip> s3://bucket/releases/canary/<zip>"
    `);
    expect({ releases, exitCode }).toEqual({ releases: before, exitCode: 0 });
  });

  test.concurrent.each<[string, Env]>([
    ["S3 fails", { STUB_FAIL_S3: "1" }],
    ["there is no webhook", { STUB_MISSING_SECRET: "BUN_ANNOUNCE_CANARY_WEBHOOK_URL" }],
  ])("canary still ships when %s", async (_, env) => {
    const { calls, exitCode } = await upload("canary", { ...main, ...env });
    expect(calls.filter(call => call.startsWith("aws "))).toHaveLength(files.length * 2);
    expect(exitCode).toBe(0);
  });

  test.concurrent.each<[string, Env, string]>([
    ["a file is missing", { STUB_MISSING_ARTIFACT: "bun-linux-x64.zip" }, "artifact download bun-linux-x64.zip"],
    ["a secret is missing", { STUB_MISSING_SECRET: "SENTRY_ORG" }, "Secret not found: SENTRY_ORG"],
    ["it is another branch", { BUILDKITE_BRANCH: "release/bun-v1.10.0" }, "only uploaded from main"],
    ["it is a pull request", { BUILDKITE_PULL_REQUEST: "123" }, "only uploaded from main"],
    ["it is a fork", { BUILDKITE_PULL_REQUEST_REPO: "https://github.com/someone/bun.git" }, "only uploaded from main"],
  ])("canary uploads nothing when %s", async (_, env, message) => {
    const { calls, stderr, exitCode } = await upload("canary", { ...main, ...env });
    expect(stderr).toContain(message);
    expect(calls.filter(call => !call.startsWith("buildkite-agent "))).toEqual([]);
    expect(exitCode).toBe(1);
  });

  test.concurrent("canary does not print the webhook when the announcement fails", async () => {
    const { stdout, stderr, exitCode } = await upload("canary", { ...main, STUB_DISCORD_STATUS: "500" });
    expect(stderr).toContain("Failed to announce the canary on Discord: 500");
    expect(stdout + stderr).not.toContain("discord.test");
    expect(exitCode).toBe(1);
  });

  test.concurrent("canary installs the programs that the machine lacks", async () => {
    // A PATH without whatever gh, aws and sentry-cli this machine has.
    using path = tempDir("release-path", programs);
    mkdirSync(join(String(path), "bin"));
    for (const name of [
      "basename",
      "cat",
      "chmod",
      "cmake",
      "cp",
      "env",
      "install",
      "mkdir",
      "mktemp",
      "sh",
      "tar",
      "gzip",
      "unzip",
    ]) {
      symlinkSync(Bun.which(name)!, join(String(path), "bin", name));
    }
    const curl = `#!/bin/bash
${log}
out="$PWD/$4"; cd "$(mktemp -d)"
case "$2" in
  */cli/cli/*) mkdir -p gh/bin && install "${path}/gh" gh/bin && tar -czf "$out" gh ;;
  */awscli-*)
    mkdir aws && printf '#!/bin/sh\\ninstall "${path}/aws" "$4"' > aws/install && chmod +x aws/install
    cmake -E tar cf "$out" --format=zip aws ;;
  *) echo 'install "${path}/sentry-cli" "$INSTALL_DIR"' > "$out" ;;
esac`;
    const { calls, exitCode } = await upload("canary", { ...main, STUB_PATH: join(String(path), "bin") }, { curl });
    const [gh, aws] = process.arch === "x64" ? ["amd64", "x86_64"] : ["arm64", "aarch64"];
    expect(calls.filter(call => call.startsWith("curl ")).map(call => call.split(" ")[2])).toEqual([
      `https://github.com/cli/cli/releases/download/v1.2.3/gh_1.2.3_linux_${gh}.tar.gz`,
      `https://awscli.amazonaws.com/awscli-exe-linux-${aws}.zip`,
      "https://sentry.io/get-cli/",
    ]);
    expect(published(calls)).toHaveLength(9);
    expect(exitCode).toBe(0);
  });

  test.concurrent("refuses another kind of release", async () => {
    const { calls, stderr, exitCode } = await upload("latest");
    expect(stderr).toContain("Expected canary or draft, got: latest");
    expect({ calls, exitCode }).toEqual({ calls: [], exitCode: 1 });
  });
});

describe.skipIf(!hasTools)("sign-darwin-artifacts.ts", () => {
  const signature = "flags=0x10000(runtime) Hash type=sha256 Timestamp=now";

  async function sign(env: Env = {}) {
    using box = sandbox({
      "buildkite-agent": agent,
      "curl": `#!/bin/bash\n${log}`,
      "security": `#!/bin/bash
${log}
[[ "$2" != *.p12 || "$(cat "$2")" == p12 ]] || exit 1
[[ -z "$STUB_SECURITY_FAILS" || "$*" != *"$STUB_SECURITY_FAILS"* ]]`,
      "ditto": `#!/bin/bash\n${log}\n[ -d "$5" ] && touch "$6"`,
      "codesign": `#!/bin/bash
${log}
[ "$1" != "$STUB_CODESIGN_FAILS" ] || exit 1
[ "$1" != "--display" ] || echo "$STUB_SIGNATURE" >&2`,
    });
    const artifacts = ["aarch64-profile", "aarch64", "x64"].map(name => `bun-darwin-${name}.zip=build-${name}`);
    const { stdout, stderr, exitCode } = await box.run(
      [process.execPath, join(repoRoot, ".buildkite", "scripts", "sign-darwin-artifacts.ts"), ...artifacts],
      {
        ...releaseBuild,
        STUB_SECRET_APPLE_DEVELOPER_ID_P12_BASE64: btoa("p12"),
        STUB_SECRET_APPLE_DEVELOPER_ID_P12_PASSWORD: "hunter2",
        STUB_SIGNATURE: signature,
        STUB_REVISION: "1.10.0+012345678",
        STUB_BINARY: `#!/bin/bash
${log}
[ "$1" != "--revision" ] || echo "$STUB_REVISION"
[ "$1" != "build" ] || { printf '#!/bin/bash\\nexit %s' "\${STUB_COMPILED_EXIT_CODE:-0}" > "$5"; chmod +x "$5"; }
# `,
        ...env,
      },
    );
    const calls = box.calls().map(call =>
      call
        .replaceAll(/\S+\/sign-\w{6}\b/g, "<work>")
        .replaceAll(repoRoot, "<checkout>")
        .replaceAll(/[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}/g, "<uuid>"),
    );
    const leftovers = readdirSync(box.path).filter(name => name.startsWith("sign-"));
    return { printed: stdout + stderr, exitCode, calls, leftovers };
  }

  test.concurrent("signs, checks and uploads each zip", async () => {
    const { calls, exitCode } = await sign();
    expect(calls.join("\n")).toMatchInlineSnapshot(`
      "security create-keychain -p <uuid> <work>/signing.keychain-db
      security set-keychain-settings <work>/signing.keychain-db
      security unlock-keychain -p <uuid> <work>/signing.keychain-db
      curl -fsSL --retry 3 -o DeveloperIDCA.cer https://www.apple.com/certificateauthority/DeveloperIDCA.cer
      security import <work>/DeveloperIDCA.cer -k <work>/signing.keychain-db
      curl -fsSL --retry 3 -o DeveloperIDG2CA.cer https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer
      security import <work>/DeveloperIDG2CA.cer -k <work>/signing.keychain-db
      buildkite-agent secret get APPLE_DEVELOPER_ID_P12_BASE64
      buildkite-agent secret get APPLE_DEVELOPER_ID_P12_PASSWORD
      security import <work>/identity.p12 -k <work>/signing.keychain-db -f pkcs12 -P hunter2 -T /usr/bin/codesign
      security set-key-partition-list -S apple-tool:,apple: -s -k <uuid> <work>/signing.keychain-db
      security list-keychains -d user -s <work>/signing.keychain-db
      buildkite-agent artifact download bun-darwin-aarch64-profile.zip . --step build-aarch64-profile
      codesign --entitlements <checkout>/.buildkite/scripts/entitlements.profile.plist --options runtime --force --timestamp -vvvv --deep --strict --keychain <work>/signing.keychain-db --sign Developer ID Application <work>/bun-darwin-aarch64-profile/bun-profile
      codesign --verify --strict --verbose=2 --test-requirement==identifier "bun-profile" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "7FRXF46ZSN" <work>/bun-darwin-aarch64-profile/bun-profile
      codesign --display --verbose=3 <work>/bun-darwin-aarch64-profile/bun-profile
      bun-profile --revision
      bun-profile build --compile smoke.js --outfile smoke
      ditto -ck --rsrc --sequesterRsrc --keepParent bun-darwin-aarch64-profile bun-darwin-aarch64-profile.zip
      buildkite-agent artifact upload bun-darwin-aarch64-profile.zip
      buildkite-agent artifact download bun-darwin-aarch64.zip . --step build-aarch64
      codesign --entitlements <checkout>/entitlements.plist --options runtime --force --timestamp -vvvv --deep --strict --keychain <work>/signing.keychain-db --sign Developer ID Application <work>/bun-darwin-aarch64/bun
      codesign --verify --strict --verbose=2 --test-requirement==identifier "bun" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "7FRXF46ZSN" <work>/bun-darwin-aarch64/bun
      codesign --display --verbose=3 <work>/bun-darwin-aarch64/bun
      bun --revision
      bun build --compile smoke.js --outfile smoke
      ditto -ck --rsrc --sequesterRsrc --keepParent bun-darwin-aarch64 bun-darwin-aarch64.zip
      buildkite-agent artifact upload bun-darwin-aarch64.zip
      buildkite-agent artifact download bun-darwin-x64.zip . --step build-x64
      codesign --entitlements <checkout>/entitlements.plist --options runtime --force --timestamp -vvvv --deep --strict --keychain <work>/signing.keychain-db --sign Developer ID Application <work>/bun-darwin-x64/bun
      codesign --verify --strict --verbose=2 --test-requirement==identifier "bun" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "7FRXF46ZSN" <work>/bun-darwin-x64/bun
      codesign --display --verbose=3 <work>/bun-darwin-x64/bun
      ditto -ck --rsrc --sequesterRsrc --keepParent bun-darwin-x64 bun-darwin-x64.zip
      buildkite-agent artifact upload bun-darwin-x64.zip
      security delete-keychain <work>/signing.keychain-db"
    `);
    expect(exitCode).toBe(0);
  });

  test("the entitlements it names exist", () => {
    const keys = (...path: string[]) =>
      [...readFileSync(join(repoRoot, ...path), "utf8").matchAll(/<key>(.+)<\/key>/g)].map(match => match[1]);
    expect(keys(".buildkite", "scripts", "entitlements.profile.plist")).toEqual([
      ...keys("entitlements.plist"),
      "com.apple.security.get-task-allow",
    ]);
  });

  test.concurrent.each<[string, Env]>([
    ["the password is wrong", { STUB_SECURITY_FAILS: "pkcs12" }],
    ["a secret is missing", { STUB_MISSING_SECRET: "APPLE_DEVELOPER_ID_P12_BASE64" }],
    ["signing fails", { STUB_CODESIGN_FAILS: "--entitlements" }],
    ["the signer is someone else", { STUB_CODESIGN_FAILS: "--verify" }],
    ["the runtime flag is missing", { STUB_SIGNATURE: signature.replace("0x10000(runtime)", "0x0(none)") }],
    ["the hash is another", { STUB_SIGNATURE: signature.replace("sha256", "sha1") }],
    ["the timestamp is missing", { STUB_SIGNATURE: signature.replace("Timestamp", "Signed Time") }],
    ["the binary is a canary", { STUB_REVISION: "1.10.0-canary.1+012345678" }],
    ["the binary is of another commit", { STUB_REVISION: "1.10.0+fedcba987" }],
    ["a compiled executable does not run", { STUB_COMPILED_EXIT_CODE: "1" }],
    ["the zip is missing", { STUB_MISSING_ARTIFACT: "bun-darwin-aarch64-profile.zip" }],
  ])("uploads nothing when %s", async (_, env) => {
    const { calls, printed, leftovers, exitCode } = await sign(env);
    expect(printed).not.toContain("hunter2");
    expect(calls.filter(call => call.includes("artifact upload"))).toEqual([]);
    expect(calls.at(-1)).toBe("security delete-keychain <work>/signing.keychain-db");
    expect({ leftovers, exitCode }).toEqual({ leftovers: [], exitCode: 1 });
  });
});
