import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";

// scripts/find-build.ts asks `bk` for the builds and `gh` for the branch of a PR. Here both are shell
// scripts on PATH that record their arguments. `bk api` answers as the Buildkite REST API does.
// `.../annotations`: 30 annotations per page unless `per_page` asks for more, 100 at most, pages
// count from 1, and `omit_body=true` leaves `body_html` out. `/pipelines/bun/builds?branch=main`:
// the builds of main, newest first, only in the states that `state[]` names, only those created
// before `created_to`, and `per_page` of them. `/pipelines/bun/builds/<number>`: that build, with the
// `jobs` that the test gives it. `/pipelines/bun/builds?branch=<branch>&per_page=1`: the newest build of
// the branch. Shell scripts do not resolve as executables on Windows, hence the skip.
describe.skipIf(isWindows)("scripts/find-build.ts with a canned `bk` and `gh`", () => {
  const script = join(import.meta.dir, "..", "..", "scripts", "find-build.ts");
  const fakeGh = [
    "#!/bin/sh",
    'echo "gh $*" >> "$FAKE/calls"',
    'case "$1 $2" in',
    '  "pr view") cat "$FAKE/pr-$3" ;;',
    "  *)",
    '    echo "no canned answer for: gh $*" >&2',
    "    exit 1",
    "    ;;",
    "esac",
    "",
  ].join("\n");
  const fakeBk = [
    "#!/bin/sh",
    'echo "bk $*" >> "$FAKE/calls"',
    'if [ -n "$FAKE_FAILING" ]; then',
    '  case "$*" in',
    '    *"$FAKE_FAILING"*)',
    '      echo "Error: error making request: HTTP request failed: 500 Internal Server Error" >&2',
    "      exit 1",
    "      ;;",
    "  esac",
    "fi",
    'if [ "bk $*" = "$FAKE_FAILING_CALL" ]; then',
    '  echo "Error: error making request: HTTP request failed: 500 Internal Server Error" >&2',
    "  exit 1",
    "fi",
    'case "$1 $2" in',
    '  "api /pipelines/bun/builds/"*"/annotations"*)',
    "    build=${2#/pipelines/bun/builds/}",
    "    build=${build%%/*}",
    "    per_page=$(echo \"$2\" | sed -n 's/.*[?&]per_page=\\([0-9]*\\).*/\\1/p')",
    "    page=$(echo \"$2\" | sed -n 's/.*[?&]page=\\([0-9]*\\).*/\\1/p')",
    "    per_page=${per_page:-30}",
    "    page=${page:-1}",
    '    if [ "$per_page" -gt 100 ]; then per_page=100; fi',
    '    if [ "$page" = "$FAKE_FAILING_PAGE" ]; then',
    '      echo "Error: error making request: HTTP request failed: 500 Internal Server Error" >&2',
    "      exit 1",
    "    fi",
    '    case "$2" in',
    '      *omit_body=true*) file="$FAKE/annotations-$build.names.jsonl" ;;',
    '      *) file="$FAKE/annotations-$build.jsonl" ;;',
    "    esac",
    // One annotation per line in the file. A comma goes after each line of the page but the last.
    '    echo "["',
    '    sed -n "$(((page - 1) * per_page + 1)),$((page * per_page))p" "$file" | sed \'$!s/$/,/\'',
    '    echo "]"',
    // A running build: after the first page is read, one annotation arrives ahead of the others.
    '    if [ "$page" = 1 ] && [ -f "$FAKE/annotations-$build.jsonl.added" ]; then',
    '      for list in "$FAKE/annotations-$build.jsonl" "$FAKE/annotations-$build.names.jsonl"; do',
    '        cat "$list.added" "$list" > "$list.now" && mv "$list.now" "$list" && rm "$list.added"',
    "      done",
    "    fi",
    "    ;;",
    // One build of the branch per line in the file, newest first.
    '  "api /pipelines/bun/builds?branch="*"&per_page=1&include_retried_jobs=true")',
    "    branch=${2#/pipelines/bun/builds?branch=}",
    '    echo "["',
    '    head -n 1 "$FAKE/list-${branch%%&*}.jsonl"',
    '    echo "]"',
    "    ;;",
    // One build of main per line in the file, newest first.
    '  "api /pipelines/bun/builds?branch=main&"*)',
    "    states=$(echo \"$2\" | tr '&' '\\n' | sed -n 's/^state\\[\\]=//p' | paste -sd '|' -)",
    "    created_to=$(echo \"$2\" | sed -n 's/.*[?&]created_to=\\([^&]*\\).*/\\1/p')",
    "    per_page=$(echo \"$2\" | sed -n 's/.*[?&]per_page=\\([0-9]*\\).*/\\1/p')",
    '    echo "["',
    '    grep -E "\\"state\\":\\"(${states:-[a-z_]*})\\"" "$FAKE/main.jsonl" |',
    '      awk -v to="$created_to" \'{ at = $0; sub(/.*"created_at":"/, "", at); sub(/".*/, "", at) } to == "" || at < to\' |',
    "      head -n \"${per_page:-30}\" | sed '$!s/$/,/'",
    '    echo "]"',
    "    ;;",
    '  "api /pipelines/bun/builds/"*)',
    "    build=${2#/pipelines/bun/builds/}",
    '    cat "$FAKE/build-${build%%\\?*}.json"',
    "    ;;",
    "  *)",
    '    echo "no canned answer for: bk $*" >&2',
    "    exit 1",
    "    ;;",
    "esac",
    "",
  ].join("\n");

  type Annotation = { id: string; context: string; style: "error" | "warning" | "info"; body_html: string };

  const details = (file: string, what: string) =>
    `<details><summary><a href="https://github.com/oven-sh/bun/blob/main/${file}"><code>${file}</code></a> - ${what}</summary>\n` +
    `<pre class="term"><code>1 fail</code></pre>\n</details>\n`;
  const failingFile = (n: number) => `test/js/failing-${n}.test.ts`;
  const failing = (file: string): Annotation => ({
    id: file,
    context: file,
    style: "error",
    body_html: details(file, "code 1 on 13 x64 - test-bun"),
  });
  /** One error annotation for each of `test/js/failing-1.test.ts` to `test/js/failing-<count>.test.ts`. */
  const failingFiles = (count: number) => Array.from({ length: count }, (_, i) => failing(failingFile(i + 1)));
  /** The one annotation that lists every test file that passed on a retry. */
  const flaky = (...files: string[]): Annotation => ({
    id: "flaky",
    context: "flaky",
    style: "warning",
    body_html: files.map(file => details(file, "code 1 on 13 x64 - test-bun (1 retry)")).join(""),
  });
  const binarySize: Annotation = {
    id: "binary-size",
    context: "binary-size",
    style: "info",
    body_html: "<p>+0 KB</p>",
  };

  /** 230 annotations, none of them a failing test file. */
  const manyOthers = Array.from({ length: 230 }, (_, i) => ({ ...binarySize, id: `other-${i + 1}` }));

  const heading = (context: string, tag = "") => `== ${context} ==${tag}`;
  const failingHeadings = (count: number) => Array.from({ length: count }, (_, i) => heading(failingFile(i + 1)));
  /** A page of annotations with their bodies. */
  const request = (build: number, page: number) =>
    `bk api /pipelines/bun/builds/${build}/annotations?per_page=100&page=${page}`;
  /** A page of annotations without their bodies. */
  const names = (build: number, page: number) => `${request(build, page)}&omit_body=true`;
  /** Asks whether the build has an annotation after the 200 that were read. */
  const after200 = (build: number) =>
    `bk api /pipelines/bun/builds/${build}/annotations?per_page=1&page=201&omit_body=true`;

  /** Build `number` is created `number` minutes into 2026, so a higher number is a later build. */
  const createdAt = (number: number) => new Date(Date.UTC(2026, 0, 1, 0, number)).toISOString();
  /** A build as `bk api /pipelines/bun/builds` gives it. `jobs`: every attempt of each of its jobs. */
  const buildOf = (branch: string, number: number, jobs: readonly object[] = []) => ({
    number,
    branch,
    state: "failed",
    created_at: createdAt(number),
    web_url: `https://buildkite.com/bun/bun/builds/${number}`,
    jobs,
  });
  /**
   * A build of main. `reported`: how many of its jobs set a `reported-<job>` meta-data key. Every test job does
   * when it ends. A build that stops at a compile error has the few keys of its failed build steps.
   */
  const onMain = (number: number, state = "failed", reported = 4) => ({
    ...buildOf("main", number),
    state,
    meta_data: {
      "timings:linux-x64-build-bun": "{}",
      ...Object.fromEntries(Array.from({ length: reported }, (_, job) => [`reported-${number}-${job}`, "1"])),
    },
  });
  /** The newest ten passed or failed builds of main. */
  const complete =
    "bk api /pipelines/bun/builds?branch=main&state[]=passed&state[]=failed&exclude_jobs=true&exclude_pipeline=true&per_page=10";
  /** The same, of those created before the build. */
  const completeBefore = (build: number) => `${complete}&created_to=${createdAt(build)}`;
  /**
   * Asks for a build with every attempt of its jobs: the attempts that Buildkite replaced too. The comparison
   * takes the branch and the creation time of a target that is given as a build number from the same answer.
   */
  const attempts = (build: number) => `bk api /pipelines/bun/builds/${build}?include_retried_jobs=true`;
  /** Asks for the newest build of a branch, with every attempt of its jobs. */
  const newest = (branch: string) =>
    `bk api /pipelines/bun/builds?branch=${branch}&per_page=1&include_retried_jobs=true`;

  interface Canned {
    /** `bk api /pipelines/bun/builds/<key>/annotations`, in the order the API lists them. */
    annotations: Record<number, readonly Annotation[]>;
    /** `bk api /pipelines/bun/builds?branch=<key>`: the builds of the branch, newest first. */
    lists?: Record<string, readonly ReturnType<typeof buildOf>[]>;
    /** `bk api /pipelines/bun/builds?branch=main`: every build of main, newest first. */
    main?: readonly ReturnType<typeof onMain>[];
    /** `bk api /pipelines/bun/builds/<number>` */
    builds?: readonly (ReturnType<typeof buildOf> & { started_at?: string | null; finished_at?: string | null })[];
    /** `gh pr view <key>`: the branch of the pull request. */
    prs?: Record<number, string>;
    /** The annotations page on which `bk api` fails. */
    failingPage?: number;
    /** `bk` fails when its arguments contain this text. */
    failing?: string;
    /** `bk` fails for exactly this call. */
    failingCall?: string;
    /** An annotation that the build `<key>` gets ahead of its others, after the script read the first page. */
    added?: Record<number, Annotation>;
  }

  async function runFindBuild(
    args: string[],
    {
      annotations,
      lists = {},
      main = [],
      builds = [],
      prs = {},
      failingPage,
      failing,
      failingCall,
      added = {},
    }: Canned,
  ) {
    using dir = tempDir("find-build", {
      "bin/gh": fakeGh,
      "bin/bk": fakeBk,
      "calls": "",
      "main.jsonl": main.map(build => JSON.stringify(build) + "\n").join(""),
      ...Object.fromEntries(builds.map(build => [`build-${build.number}.json`, JSON.stringify(build)])),
      ...Object.fromEntries(Object.entries(prs).map(([pr, branch]) => [`pr-${pr}`, branch + "\n"])),
      ...Object.fromEntries(
        Object.entries(annotations).flatMap(([build, list]) => [
          [`annotations-${build}.jsonl`, list.map(annotation => JSON.stringify(annotation) + "\n").join("")],
          [
            `annotations-${build}.names.jsonl`,
            list.map(({ body_html, ...summary }) => JSON.stringify(summary) + "\n").join(""),
          ],
        ]),
      ),
      ...Object.fromEntries(
        Object.entries(added).flatMap(([build, { body_html, ...summary }]) => [
          [`annotations-${build}.jsonl.added`, JSON.stringify({ body_html, ...summary }) + "\n"],
          [`annotations-${build}.names.jsonl.added`, JSON.stringify(summary) + "\n"],
        ]),
      ),
      ...Object.fromEntries(
        Object.entries(lists).map(([branch, builds]) => [
          `list-${branch}.jsonl`,
          builds.map(build => JSON.stringify(build) + "\n").join(""),
        ]),
      ),
    });
    const bin = join(String(dir), "bin");
    chmodSync(join(bin, "gh"), 0o755);
    chmodSync(join(bin, "bk"), 0o755);

    await using proc = Bun.spawn({
      cmd: [bunExe(), script, ...args],
      env: {
        ...bunEnv,
        PATH: `${bin}:${bunEnv.PATH}`,
        FAKE: String(dir),
        FAKE_FAILING_PAGE: String(failingPage ?? ""),
        FAKE_FAILING: failing ?? "",
        FAKE_FAILING_CALL: failingCall ?? "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stdout.split("\n");
    // The script reads several builds at the same time, and the pages of one build one after the other.
    const calls: Record<string, string[]> = {};
    for (const call of readFileSync(join(String(dir), "calls"), "utf8").split("\n")) {
      const build = call.match(/^bk api \/pipelines\/bun\/builds\/(\d+)\/annotations/)?.[1];
      const key = build ?? (call.startsWith("bk api ") ? "builds" : call.startsWith("gh ") ? "gh" : undefined);
      if (key) (calls[key] ??= []).push(call);
    }
    // The comparison asks for the builds of main and for the target at the same time.
    calls.builds?.sort();
    const requests: Record<string, readonly string[]> = calls;
    return {
      stdout: lines,
      /** The `== <context> ==` line above each annotation that `--errors` prints. */
      headings: lines.filter(line => line.startsWith("== ")),
      /** The lines of `--errors` that say that the list is cut, what it is compared with, and what is left out. */
      notes: lines.filter(line =>
        /^(\(only the first |compared with main |not compared with main: |\(\d+ sections? of |\(replaced job attempts |  The latest attempt )/.test(
          line,
        ),
      ),
      stderr,
      exitCode,
      /**
       * The `bk api` calls for the annotations of each build, in the order the script made them. `builds`: its
       * other `bk api` calls, sorted. They ask for the builds of main, which only the comparison does, and for
       * the target with every attempt of its jobs. `gh`: its `gh` calls. A key is absent when the script made
       * no such call.
       */
      requests,
    };
  }

  // An ASAN build starts too slowly to run all of these at the same time within the default timeout.
  const scenario = test.concurrentIf(!isASAN);

  const cutNote = "(only the first 200 annotations of this build are read)";
  const failedRequest = (request: string) =>
    `${request}: Error: error making request: HTTP request failed: 500 Internal Server Error`;

  scenario.each([
    { count: 31, requests: { 7: [request(7, 1)] } },
    { count: 100, requests: { 7: [request(7, 1), request(7, 2)] } },
    { count: 200, requests: { 7: [request(7, 1), request(7, 2), after200(7)] } },
  ])("--errors prints $count of $count failing test files", async ({ count, requests }) => {
    const result = await runFindBuild(["--errors", "7", "--no-compare"], { annotations: { 7: failingFiles(count) } });
    expect(result).toEqual({
      stdout: expect.any(Array),
      headings: failingHeadings(count),
      notes: [],
      stderr: "",
      exitCode: 0,
      requests,
    });
  });

  scenario("--errors prints the first 200 of 230 failing test files and says so above and below them", async () => {
    const result = await runFindBuild(["--errors", "7", "--no-compare"], { annotations: { 7: failingFiles(230) } });
    expect(result).toEqual({
      stdout: expect.any(Array),
      headings: failingHeadings(200),
      notes: [cutNote, cutNote],
      stderr: "",
      exitCode: 0,
      requests: { 7: [request(7, 1), request(7, 2), after200(7)] },
    });
    expect(result.stdout.slice(0, 5)).toEqual([
      "build #7  https://buildkite.com/bun/bun/builds/7",
      "",
      cutNote,
      "",
      heading(failingFile(1)),
    ]);
    expect(result.stdout.slice(-3)).toEqual(["", cutNote, ""]);
  });

  scenario("--errors prints the first 200 with the note when the request that looks for a 201st fails", async () => {
    const result = await runFindBuild(["--errors", "7", "--no-compare"], {
      annotations: { 7: failingFiles(200) },
      failingPage: 201,
    });
    expect(result).toEqual({
      stdout: expect.any(Array),
      headings: failingHeadings(200),
      notes: [cutNote, cutNote],
      stderr: "",
      exitCode: 0,
      requests: { 7: [request(7, 1), request(7, 2), after200(7)] },
    });
  });

  scenario("--errors prints each annotation once when a new one moves the list between two pages", async () => {
    const result = await runFindBuild(["--errors", "7", "--no-compare"], {
      annotations: { 7: failingFiles(230) },
      added: { 7: { ...flaky("test/js/retried.test.ts"), id: "flaky-new", context: "flaky-new" } },
    });
    // The second page starts with the 100th failing file again, so the two pages hold 199 annotations.
    const note = "(only the first 199 annotations of this build are read)";
    expect(result).toEqual({
      stdout: expect.any(Array),
      headings: failingHeadings(199),
      notes: [note, note],
      stderr: "",
      exitCode: 0,
      requests: { 7: [request(7, 1), request(7, 2), after200(7)] },
    });
  });

  // The new annotation is ahead of the ones that the first page held, so this run does not have it.
  scenario.each([
    { count: 150, requests: { 7: [request(7, 1), request(7, 2)] } },
    { count: 199, requests: { 7: [request(7, 1), request(7, 2), after200(7)] } },
  ])(
    "--errors says that the list is not whole when a new annotation moves a list of $count",
    async ({ count, requests }) => {
      const result = await runFindBuild(["--errors", "7", "--no-compare"], {
        annotations: { 7: failingFiles(count) },
        added: { 7: { ...flaky("test/js/retried.test.ts"), id: "flaky-new", context: "flaky-new" } },
      });
      const note = `(only the first ${count} annotations of this build are read)`;
      expect(result).toEqual({
        stdout: expect.any(Array),
        headings: failingHeadings(count),
        notes: [note, note],
        stderr: "",
        exitCode: 0,
        requests,
      });
    },
  );

  scenario("--errors makes one request for a build with no annotations", async () => {
    const result = await runFindBuild(["--errors", "7", "--no-compare"], { annotations: { 7: [] } });
    expect(result).toEqual({
      stdout: ["build #7  https://buildkite.com/bun/bun/builds/7", "", "no error annotations", ""],
      headings: [],
      notes: [],
      stderr: "",
      exitCode: 0,
      requests: { 7: [request(7, 1)] },
    });
  });

  scenario("--errors limits `no error annotations` to the first 200 when the list is cut", async () => {
    const result = await runFindBuild(["--errors", "7", "--no-compare"], {
      annotations: { 7: manyOthers },
    });
    expect(result).toEqual({
      stdout: [
        "build #7  https://buildkite.com/bun/bun/builds/7",
        "",
        cutNote,
        "no error annotations in the first 200 (200 warning/info; pass --all to show)",
        "",
      ],
      headings: [],
      notes: [cutNote],
      stderr: "",
      exitCode: 0,
      requests: { 7: [request(7, 1), request(7, 2), after200(7)] },
    });
  });

  scenario("--errors --all prints the flaky tests and the other annotations of a later page", async () => {
    const result = await runFindBuild(["--errors", "7", "--no-compare", "--all"], {
      annotations: { 7: [...failingFiles(120), flaky("test/js/retried.test.ts"), binarySize] },
    });
    expect(result).toEqual({
      stdout: expect.any(Array),
      headings: [...failingHeadings(120), heading("binary-size"), heading("test/js/retried.test.ts", " [flaky]")],
      notes: [],
      stderr: "",
      exitCode: 0,
      requests: { 7: [request(7, 1), request(7, 2)] },
    });
  });

  scenario("--errors fails when a later page fails, and prints no part of the list", async () => {
    const result = await runFindBuild(["--errors", "7", "--no-compare"], {
      annotations: { 7: failingFiles(230) },
      failingPage: 2,
    });
    expect(result).toEqual({
      stdout: ["build #7  https://buildkite.com/bun/bun/builds/7", "", ""],
      headings: [],
      notes: [],
      stderr: failedRequest(request(7, 2)) + "\n",
      exitCode: 1,
      requests: { 7: [request(7, 1), request(7, 2)] },
    });
  });

  describe("--errors with the comparison", () => {
    const onThisBranch = "test/js/only-on-this-branch.test.ts";
    /** A test file that fails in build `number` of main and in no other build of main. */
    const onlyOn = (number: number) => `test/js/only-on-main-${number}.test.ts`;
    // Build 7 is the target, on a branch. Build 8 of main was canceled. So 7 is compared with builds 6 and 5
    // of main, which are below it, and with build 9, the first one above it.
    const main = [onMain(10), onMain(9), onMain(8, "canceled"), onMain(6), onMain(5), onMain(3)];
    const annotations = {
      10: [failing(onlyOn(10)), failing(failingFile(5)), binarySize],
      9: [failing(onlyOn(9)), failing(failingFile(5)), binarySize],
      8: [failing(onlyOn(8))],
      7: [
        // An error here, and not an error on main: only an error annotation of main is compared with.
        { ...binarySize, style: "error" as const },
        failing(failingFile(5)),
        failing(onlyOn(9)),
        // The 32nd and the 102nd annotation of build 6: after the first page of 30, and of 100.
        failing(failingFile(32)),
        failing(failingFile(102)),
        failing(failingFile(220)),
        failing(onlyOn(5)),
        failing(onThisBranch),
        failing(onlyOn(8)),
        failing(onlyOn(3)),
        failing(onlyOn(10)),
      ],
      6: [
        ...failingFiles(230),
        flaky(onThisBranch),
        { ...failing(onThisBranch), id: "warning", style: "warning" as const },
      ],
      5: [failing(onlyOn(5)), failing(failingFile(5)), binarySize],
      3: [failing(onlyOn(3))],
    };
    const tagged = {
      headings: [
        heading("binary-size", " [new]"),
        heading(onThisBranch, " [new]"),
        heading(onlyOn(8), " [new]"),
        heading(onlyOn(3), " [new]"),
        heading(onlyOn(10), " [new]"),
        heading(onlyOn(9), " [on newer main #9]"),
        heading(failingFile(5), " [pre-existing]"),
        heading(failingFile(32), " [pre-existing]"),
        heading(failingFile(102), " [pre-existing]"),
        heading(failingFile(220), " [pre-existing]"),
        heading(onlyOn(5), " [pre-existing]"),
      ],
      notes: ["compared with main #6 (230 failing), #5 (2 failing), newer #9 (2 failing)"],
      stderr: "",
      exitCode: 0,
    };
    const read = {
      7: [request(7, 1)],
      6: [names(6, 1), names(6, 2), names(6, 3)],
      5: [names(5, 1)],
      9: [names(9, 1)],
    };

    scenario("tags from the two builds of main below a build number, and the first one above it", async () => {
      const result = await runFindBuild(["--errors", "7"], { main, annotations, builds: [buildOf("a-branch", 7)] });
      expect(result).toEqual({
        stdout: expect.any(Array),
        ...tagged,
        requests: { ...read, builds: [attempts(7), complete] },
      });
      expect(result.stdout.slice(0, 4)).toEqual([
        "build #7  https://buildkite.com/bun/bun/builds/7",
        "",
        tagged.notes[0],
        "",
      ]);
    });

    const byName: { target: string; gh: Record<string, readonly string[]> }[] = [
      { target: "a-branch", gh: {} },
      { target: "#123", gh: { gh: ["gh pr view 123 --repo oven-sh/bun --json headRefName -q .headRefName"] } },
    ];
    scenario.each(byName)("tags the newest build of $target the same", async ({ target, gh }) => {
      const result = await runFindBuild(["--errors", target], {
        main,
        annotations,
        lists: { "a-branch": [buildOf("a-branch", 7)] },
        prs: { 123: "a-branch" },
      });
      expect(result).toEqual({
        stdout: expect.any(Array),
        ...tagged,
        requests: { ...read, builds: [newest("a-branch"), complete], ...gh },
      });
    });

    // A build of main is compared with the builds before it only: the next build of main has what it brought.
    const onMainTargets: {
      target: string;
      canned: Partial<Canned>;
      headings: string[];
      notes: string[];
      requests: Record<string, readonly string[]>;
    }[] = [
      {
        target: "main",
        canned: { lists: { main: [onMain(10)] } },
        headings: [heading(onlyOn(10), " [new]"), heading(failingFile(5), " [pre-existing]")],
        notes: ["compared with main #9 (2 failing), #6 (230 failing)"],
        requests: { 10: [request(10, 1)], 9: read[9], 6: read[6], builds: [newest("main"), complete] },
      },
      {
        target: "5",
        canned: { builds: [onMain(5)] },
        // Builds 6, 9 and 10 have the second one too.
        headings: [heading(onlyOn(5), " [new]"), heading(failingFile(5), " [new]")],
        notes: ["compared with main #3 (1 failing)"],
        requests: { 5: [request(5, 1)], 3: [names(3, 1)], builds: [attempts(5), complete] },
      },
    ];
    scenario.each(onMainTargets)(
      "tags a build of main ($target) from the builds of main below it",
      async ({ target, canned, headings, notes, requests }) => {
        const result = await runFindBuild(["--errors", target], { main, annotations, ...canned });
        expect(result).toEqual({ stdout: expect.any(Array), headings, notes, stderr: "", exitCode: 0, requests });
      },
    );

    // Builds 21 to 13 of main are above the target, and 6, 5 and 3 are below it.
    const older = [...Array.from({ length: 9 }, (_, i) => onMain(21 - i)), onMain(6), onMain(5), onMain(3)];
    const before = "test/js/on-main-before-the-target.test.ts";
    const olderTargets: {
      held: string;
      ofMain: ReturnType<typeof onMain>[];
      headings: string[];
      notes: string[];
      requests: Record<string, readonly string[]>;
    }[] = [
      {
        // With build 22, the ten newest end at build 13. Which build is the first above the target is not known.
        held: "none of them",
        ofMain: [onMain(22), ...older],
        headings: [
          heading(onlyOn(21), " [new]"),
          heading(onlyOn(13), " [new]"),
          heading(onThisBranch, " [new]"),
          heading(before, " [pre-existing]"),
        ],
        notes: ["compared with main #6 (1 failing), #5 (0 failing)"],
        requests: { 6: [names(6, 1)], 5: [names(5, 1)] },
      },
      {
        held: "one of them",
        ofMain: older,
        headings: [
          heading(onlyOn(21), " [new]"),
          heading(onThisBranch, " [new]"),
          heading(onlyOn(13), " [on newer main #13]"),
          heading(before, " [pre-existing]"),
        ],
        notes: ["compared with main #6 (1 failing), #5 (0 failing), newer #13 (1 failing)"],
        requests: { 6: [names(6, 1)], 5: [names(5, 1)], 13: [names(13, 1)] },
      },
      {
        // Build 6 is the only build of main before the target: the second request is the last one.
        held: "none of them, and main has one build before the target",
        ofMain: [onMain(22), ...older.slice(0, 10)],
        headings: [
          heading(onlyOn(21), " [new]"),
          heading(onlyOn(13), " [new]"),
          heading(onThisBranch, " [new]"),
          heading(before, " [pre-existing]"),
        ],
        notes: ["compared with main #6 (1 failing)"],
        requests: { 6: [names(6, 1)] },
      },
    ];
    scenario.each(olderTargets)(
      "asks for the builds of main before a target when the newest ten hold $held",
      async ({ ofMain, headings, notes, requests }) => {
        const result = await runFindBuild(["--errors", "7"], {
          main: ofMain,
          annotations: {
            21: [failing(onlyOn(21))],
            13: [failing(onlyOn(13))],
            7: [failing(before), failing(onlyOn(21)), failing(onlyOn(13)), failing(onThisBranch)],
            6: [failing(before)],
            5: [],
          },
          builds: [buildOf("a-branch", 7)],
        });
        expect(result).toEqual({
          stdout: expect.any(Array),
          headings,
          notes,
          stderr: "",
          exitCode: 0,
          requests: { 7: [request(7, 1)], ...requests, builds: [attempts(7), complete, completeBefore(7)] },
        });
      },
    );

    scenario("compares a build that has no failing test file, and says with what", async () => {
      const result = await runFindBuild(["--errors", "7"], {
        // The ten newest hold the two builds below the target: no second request.
        main: older.slice(1),
        annotations: { 13: [], 7: [], 6: [failing(failingFile(1))], 5: [] },
        builds: [buildOf("a-branch", 7)],
      });
      const note = "compared with main #6 (1 failing), #5 (0 failing), newer #13 (0 failing)";
      expect(result).toEqual({
        stdout: ["build #7  https://buildkite.com/bun/bun/builds/7", "", note, "no error annotations", ""],
        headings: [],
        notes: [note],
        stderr: "",
        exitCode: 0,
        requests: {
          7: [request(7, 1)],
          6: [names(6, 1)],
          5: [names(5, 1)],
          13: [names(13, 1)],
          builds: [attempts(7), complete],
        },
      });
    });

    // Builds 8, 6 and 5 of main stopped at a compile error: one failed build step reported, and no test job.
    // Build 3 counts: half as many jobs reported as in the best build.
    const compileError = "[E0425] cannot find value `x` in this scope";
    const inFour = "test/js/on-main-4.test.ts";
    const stopped = {
      annotations: {
        9: [],
        8: [failing(compileError)],
        7: [failing(inFour), failing(onThisBranch)],
        6: [failing(compileError)],
        5: [failing(compileError)],
        4: [failing(inFour)],
        3: [],
        2: [],
        14: [],
      },
      headings: [heading(onThisBranch, " [new]"), heading(inFour, " [pre-existing]")],
    };
    const stoppedBuilds: {
      where: string;
      ofMain: ReturnType<typeof onMain>[];
      notes: string[];
      requests: Record<string, readonly string[]>;
    }[] = [
      {
        where: "in the ten newest",
        ofMain: [
          onMain(9),
          onMain(8, "failed", 1),
          onMain(6, "failed", 1),
          onMain(5, "failed", 1),
          onMain(4),
          onMain(3, "passed", 2),
          onMain(2),
        ],
        notes: ["compared with main #4 (1 failing), #3 (0 failing), newer #9 (0 failing)"],
        requests: { 4: [names(4, 1)], 3: [names(3, 1)], 9: [names(9, 1)], builds: [attempts(7), complete] },
      },
      {
        // The ten newest hold builds below the target, and none of them ran its tests: a second request.
        where: "below the target, at the end of the ten newest",
        ofMain: [
          ...Array.from({ length: 8 }, (_, i) => onMain(21 - i)),
          onMain(6, "failed", 1),
          onMain(5, "failed", 1),
          onMain(4),
          onMain(3, "passed", 2),
          onMain(2),
        ],
        notes: ["compared with main #4 (1 failing), #3 (0 failing), newer #14 (0 failing)"],
        requests: {
          4: [names(4, 1)],
          3: [names(3, 1)],
          14: [names(14, 1)],
          builds: [attempts(7), complete, completeBefore(7)],
        },
      },
    ];
    scenario.each(stoppedBuilds)(
      "does not compare with a build of main that ran no tests ($where)",
      async ({ ofMain, notes, requests }) => {
        const result = await runFindBuild(["--errors", "7"], {
          main: ofMain,
          annotations: stopped.annotations,
          builds: [buildOf("a-branch", 7)],
        });
        expect(result).toEqual({
          stdout: expect.any(Array),
          headings: stopped.headings,
          notes,
          stderr: "",
          exitCode: 0,
          requests: { 7: [request(7, 1)], ...requests },
        });
      },
    );

    scenario("--all gives no tag to an annotation that is not an error", async () => {
      const result = await runFindBuild(["--errors", "7", "--all"], {
        main: [onMain(6), onMain(5)],
        annotations: { 7: [binarySize, failing(onThisBranch)], 6: [], 5: [] },
        builds: [buildOf("a-branch", 7)],
      });
      expect(result).toEqual({
        stdout: expect.any(Array),
        headings: [heading("binary-size"), heading(onThisBranch, " [new]")],
        notes: ["compared with main #6 (0 failing), #5 (0 failing)"],
        stderr: "",
        exitCode: 0,
        requests: { 7: [request(7, 1)], 6: [names(6, 1)], 5: [names(5, 1)], builds: [attempts(7), complete] },
      });
    });

    // With a part of main's failures, the others would get the tag `[new]`.
    const notCompared: {
      why: string;
      canned: Partial<Canned>;
      reason: string;
      requests: Record<string, readonly string[]>;
    }[] = [
      {
        why: "the request for the builds of main fails",
        canned: { failing: "builds?branch=main" },
        reason: failedRequest(complete),
        requests: { 7: [request(7, 1)], builds: [attempts(7), complete] },
      },
      {
        why: "the request for the target fails",
        canned: { failing: "builds/7?" },
        reason: failedRequest(attempts(7)),
        requests: { 7: [request(7, 1)], builds: [attempts(7), complete] },
      },
      {
        why: "a page of a build of main fails",
        canned: { failing: "builds/6/annotations?per_page=100&page=2" },
        reason: failedRequest(names(6, 2)),
        requests: { ...read, 6: [names(6, 1), names(6, 2)], builds: [attempts(7), complete] },
      },
      {
        why: "main has no passed or failed build before the target",
        canned: { main: [onMain(9), onMain(8, "canceled"), onMain(6, "canceled")] },
        reason: "no passed or failed build of main ran its tests before this build",
        requests: { 7: [request(7, 1)], builds: [attempts(7), complete] },
      },
      {
        why: "no job of a build of main reported",
        canned: { main: [onMain(6, "passed", 0), onMain(5, "passed", 0)] },
        reason: "no passed or failed build of main ran its tests before this build",
        requests: { 7: [request(7, 1)], builds: [attempts(7), complete] },
      },
      {
        // The ten newest are all above the target, so the script asks for the builds before it first.
        why: "no job of a build of main before an older target reported",
        canned: { main: [onMain(22), ...older.slice(0, 9), onMain(6, "passed", 0), onMain(5, "passed", 0)] },
        reason: "no passed or failed build of main ran its tests before this build",
        requests: { 7: [request(7, 1)], builds: [attempts(7), complete, completeBefore(7)] },
      },
    ];
    scenario.each(notCompared)("prints no tag, and says why, when $why", async ({ canned, reason, requests }) => {
      const result = await runFindBuild(["--errors", "7"], {
        main,
        annotations,
        builds: [buildOf("a-branch", 7)],
        ...canned,
      });
      const note = `not compared with main: ${reason}`;
      expect(result).toEqual({
        stdout: expect.any(Array),
        headings: annotations[7].map(annotation => heading(annotation.context)),
        notes: [note, note],
        stderr: "",
        exitCode: 0,
        requests,
      });
      expect(result.stdout.slice(0, 4)).toEqual(["build #7  https://buildkite.com/bun/bun/builds/7", "", note, ""]);
      expect(result.stdout.slice(-3)).toEqual(["", note, ""]);
    });
  });

  // Only the comparison of `--errors` asks about main. The rows of `--errors --no-compare` and of `--status`
  // assert the same with their exact `requests`.
  describe("a command that does not compare", () => {
    scenario("--watch reads only the build it watches", async () => {
      const result = await runFindBuild(["--watch", "7"], {
        builds: [
          {
            ...buildOf("a-branch", 7),
            state: "passed",
            started_at: null,
            finished_at: "2999-01-01T00:00:00Z",
            jobs: [],
          },
        ],
        annotations: { 7: [] },
      });
      expect(result).toEqual({
        stdout: expect.arrayContaining(["#7 passed  https://buildkite.com/bun/bun/builds/7", "no failures"]),
        headings: [],
        notes: [],
        stderr: "",
        exitCode: 0,
        requests: { 7: [names(7, 1)], builds: [attempts(7)] },
      });
    });

    const quiet: { command: string; args: string[]; first: string }[] = [
      { command: "ci:find 7", args: ["7"], first: "7" },
      { command: "--help", args: ["--help"], first: "Usage: bun scripts/find-build.ts [target] [options]" },
    ];
    scenario.each(quiet)("$command makes no request", async ({ args, first }) => {
      const result = await runFindBuild(args, { annotations: {} });
      expect(result).toEqual({
        stdout: expect.any(Array),
        headings: [],
        notes: [],
        stderr: "",
        exitCode: 0,
        requests: {},
      });
      expect(result.stdout[0]).toBe(first);
    });
  });

  describe("--status", () => {
    /** Build 7 with its one job. */
    const build7 = (state: string, finished_at: string | null) => ({
      ...buildOf("a-branch", 7),
      state,
      started_at: null,
      finished_at,
      jobs: [{ id: "job", type: "script", name: "test-bun", state: "passed", web_url: "" }],
    });

    scenario.each([
      { count: 30, rest: ["  (+2 warning/flaky)"], requests: { 7: [names(7, 1)] } },
      {
        count: 31,
        rest: ["  (+1 more: bun run ci:errors 7)", "  (+2 warning/flaky)"],
        requests: { 7: [names(7, 1)] },
      },
      {
        count: 230,
        rest: ["  (+170 more: bun run ci:errors 7)", "  (only the first 200 annotations are counted)"],
        requests: { 7: [names(7, 1), names(7, 2), after200(7)] },
      },
    ])("names 30 of $count failing test files and counts the others", async ({ count, rest, requests }) => {
      const result = await runFindBuild(["--status", "7"], {
        builds: [build7("failed", null)],
        annotations: { 7: [...failingFiles(count), flaky("test/js/retried.test.ts"), binarySize] },
      });
      expect(result).toEqual({
        stdout: [
          "#7 failed  https://buildkite.com/bun/bun/builds/7",
          "started - ago",
          "",
          "jobs: 1 passed  (1 total)",
          "",
          "failing tests so far:",
          ...Array.from({ length: 30 }, (_, i) => `  ${failingFile(i + 1)}`),
          ...rest,
          "",
        ],
        headings: [],
        notes: [],
        stderr: "",
        exitCode: 0,
        requests: { ...requests, builds: [attempts(7)] },
      });
    });

    // The build ends in the future, which prints as `0s ago` whenever the test runs.
    const finished = build7("passed", "2999-01-01T00:00:00Z");
    const notRead = `(could not read the annotations: ${failedRequest(names(7, 2))})`;
    const summaries: { summary: string; of: string; canned: Canned; rest: string[]; requests: string[] }[] = [
      {
        summary: "no failures",
        of: "a build with no annotations",
        canned: { annotations: { 7: [] } },
        rest: ["", "no failures"],
        requests: [names(7, 1)],
      },
      {
        summary: "that the count is cut",
        of: "a build with no failing test file in its first 200 annotations",
        canned: { annotations: { 7: manyOthers } },
        rest: ["  (+200 warning/flaky)", "  (only the first 200 annotations are counted)"],
        requests: [names(7, 1), names(7, 2), after200(7)],
      },
      {
        summary: "that the annotations are not read",
        of: "a build with a page that fails",
        canned: { annotations: { 7: failingFiles(130) }, failingPage: 2 },
        rest: ["", notRead],
        requests: [names(7, 1), names(7, 2)],
      },
    ];
    scenario.each(summaries)("says $summary for $of", async ({ canned, rest, requests }) => {
      const result = await runFindBuild(["--status", "7"], { builds: [finished], ...canned });
      expect(result).toEqual({
        stdout: [
          "#7 passed  https://buildkite.com/bun/bun/builds/7",
          "started - ago, finished 0s ago",
          "",
          "jobs: 1 passed  (1 total)",
          ...rest,
          "",
        ],
        headings: [],
        notes: [],
        stderr: "",
        exitCode: 0,
        requests: { 7: requests, builds: [attempts(7)] },
      });
    });
  });

  // An annotation is a log: a job attempt appends a section when a test file fails in it, and the section stays
  // when Buildkite replaces the attempt. Buildkite counts only the latest attempt of a job. So do `--errors`,
  // `--status` and `--watch`.
  describe("a job attempt that Buildkite replaced", () => {
    /** The id of job attempt `n`, in the form of a Buildkite job id. */
    const jobId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const jobUrl = (job: number, build = 7) => `https://buildkite.com/bun/bun/builds/${build}#${jobId(job)}`;
    /** A section as the test runner writes it. Its summary links the test file, at a line, and the job attempt. */
    const section = (file: string, job: number, build = 7) =>
      `<details><summary><a href="https://github.com/oven-sh/bun/blob/main/${file}#L12"><code>${file}</code></a> - ` +
      `code 1 on <a href="${jobUrl(job, build)}">13 x64</a></summary>\n` +
      `<pre class="term"><code>attempt ${job}: 1 fail</code></pre>\n</details>\n`;
    /** An error annotation of `file` in build 7, with one section from each of `jobs`. */
    const failedIn = (file: string, ...jobs: number[]): Annotation => ({
      ...failing(file),
      body_html: jobs.map(job => section(file, job)).join(""),
    });

    /** An attempt of a test job, as the REST API gives it. `lane`: the job. Each attempt of it has that name. */
    const attempt = (n: number, rest: object = {}, lane = n) => ({
      id: jobId(n),
      type: "script",
      name: `lane ${lane} - test-bun`,
      state: "passed",
      command: "./scripts/runner.node.ts --step=lane-build-bun",
      exit_status: 0 as number | null,
      started_at: createdAt(7) as string | null,
      web_url: jobUrl(n),
      ...rest,
    });
    /** Attempt `n` lost its agent after it started. Buildkite replaced it with attempt `by`, of the same job. */
    const lost = (n: number, by: number, rest: object = {}, lane = by) =>
      attempt(n, { state: "failed", exit_status: -1, retried: true, retried_in_job_id: jobId(by), ...rest }, lane);
    /** Attempt `n` expired in the queue, and attempt `by` replaced it. It did not start. */
    const expired = (n: number, by: number) => lost(n, by, { state: "expired", exit_status: null, started_at: null });
    const unfinished = (latest: number, state: string, ...replaced: number[]) =>
      `  The latest attempt did not finish: lane ${latest} - test-bun ${state} ${jobUrl(latest)}, ` +
      `replaced ${replaced.map(n => jobUrl(n)).join(" ")}`;

    // Attempt 1 lost its agent after it reported on three files. Attempt 2 replaced it and passed. Job 3 ran once.
    const ranOnce = attempt(3, { state: "failed", exit_status: 2 });
    const every = [lost(1, 2), attempt(2), ranOnce];
    const onlyReplaced = "test/js/only-the-replaced-attempt.test.ts";
    const inBoth = "test/js/the-replaced-attempt-and-another-job.test.ts";
    const flakyInReplaced = "test/js/flaky-in-the-replaced-attempt.test.ts";
    const inBatch = "test/js/in-the-parallel-batch.test.ts";
    const annotations = {
      7: [
        failedIn(onlyReplaced, 1),
        failedIn(inBoth, 1, 3),
        // Its section names no job, so it stays. So does a file that failed in the parallel batch and passed alone.
        failing(failingFile(1)),
        // `[flaky]` keeps the file that was flaky in the replaced attempt.
        {
          ...flaky(inBatch),
          body_html:
            section(flakyInReplaced, 1) +
            details(inBatch, "1 fail <i>(in the parallel batch on 13 x64; passed alone)</i>"),
        },
      ],
    };
    const replacedOnly = (file: string) => heading(file, " [replaced attempt]");
    const flakyHeadings = [heading(flakyInReplaced, " [flaky]"), heading(inBatch, " [flaky]")];
    const live = [heading(inBoth), heading(failingFile(1)), ...flakyHeadings, replacedOnly(onlyReplaced)];
    const leftOut = "(2 sections of 1 replaced job attempt left out)";
    const byNumber = buildOf("a-branch", 7, every);
    /** The output of each section with a job that `--errors` prints. */
    const printed = (stdout: string[]) => stdout.filter(line => line.startsWith("attempt "));

    const byName: { target: string; gh: Record<string, readonly string[]> }[] = [
      { target: "a-branch", gh: {} },
      { target: "#123", gh: { gh: ["gh pr view 123 --repo oven-sh/bun --json headRefName -q .headRefName"] } },
    ];
    scenario.each(byName)("--errors leaves its sections out of the newest build of $target", async ({ target, gh }) => {
      const result = await runFindBuild(["--errors", target, "--no-compare"], {
        annotations,
        lists: { "a-branch": [byNumber] },
        prs: { 123: "a-branch" },
      });
      expect(result).toEqual({
        stdout: expect.any(Array),
        headings: live,
        notes: [leftOut, leftOut],
        stderr: "",
        exitCode: 0,
        // The build of a branch comes with every attempt of its jobs.
        requests: { 7: [request(7, 1)], builds: [newest("a-branch")], ...gh },
      });
      expect(result.stdout.slice(0, 4)).toEqual(["build #7  https://buildkite.com/bun/bun/builds/7", "", leftOut, ""]);
      expect(result.stdout.slice(-5)).toEqual(["", replacedOnly(onlyReplaced), "", leftOut, ""]);
      expect(printed(result.stdout)).toEqual(["attempt 3: 1 fail", "attempt 1: 1 fail"]);
    });

    scenario("--errors asks for the attempts of a build number, and leaves the same out", async () => {
      const result = await runFindBuild(["--errors", "7", "--no-compare"], { annotations, builds: [byNumber] });
      expect(result).toEqual({
        stdout: expect.any(Array),
        headings: live,
        notes: [leftOut, leftOut],
        stderr: "",
        exitCode: 0,
        requests: { 7: [request(7, 1)], builds: [attempts(7)] },
      });
      expect(printed(result.stdout)).toEqual(["attempt 3: 1 fail", "attempt 1: 1 fail"]);
    });

    // The note of another writer on a job that got no agent. Its section names an attempt that did not start.
    const notice: Annotation = { ...failedIn("robobun", 1), id: "robobun", context: "robobun" };
    scenario("--errors leaves nothing out when the replaced attempt did not start", async () => {
      const result = await runFindBuild(["--errors", "7", "--no-compare"], {
        annotations: { 7: [notice, failedIn(inBoth, 2, 3)] },
        builds: [buildOf("a-branch", 7, [expired(1, 2), attempt(2), ranOnce])],
      });
      expect(result).toEqual({
        stdout: expect.any(Array),
        headings: [heading("robobun"), heading(inBoth)],
        notes: [],
        stderr: "",
        exitCode: 0,
        requests: { 7: [request(7, 1)], builds: [attempts(7)] },
      });
      expect(printed(result.stdout)).toEqual(["attempt 1: 1 fail", "attempt 2: 1 fail", "attempt 3: 1 fail"]);
    });

    scenario("--errors leaves out every attempt of a job that Buildkite replaced twice", async () => {
      // Attempts 1 and 4 of job 5 lost their agent one after the other. Attempt 5 still runs.
      const twice = [lost(1, 4, {}, 5), lost(4, 5), attempt(5, { state: "running", exit_status: null }), ranOnce];
      const result = await runFindBuild(["--errors", "7", "--no-compare"], {
        annotations: { 7: [failedIn(onlyReplaced, 1), failedIn(failingFile(2), 4), failedIn(inBoth, 4, 3)] },
        builds: [buildOf("a-branch", 7, twice)],
      });
      const notes = ["(3 sections of 2 replaced job attempts left out)", unfinished(5, "(running)", 1, 4)];
      expect(result).toEqual({
        stdout: expect.any(Array),
        headings: [heading(inBoth), replacedOnly(onlyReplaced), replacedOnly(failingFile(2))],
        notes: [...notes, ...notes],
        stderr: "",
        exitCode: 0,
        requests: { 7: [request(7, 1)], builds: [attempts(7)] },
      });
      expect(printed(result.stdout)).toEqual(["attempt 3: 1 fail"]);
    });

    scenario("--errors prints every section, and says why, when the request for the attempts fails", async () => {
      const result = await runFindBuild(["--errors", "7", "--no-compare"], {
        annotations,
        builds: [byNumber],
        failing: "include_retried_jobs",
      });
      const note = `(replaced job attempts are not left out: ${failedRequest(attempts(7))})`;
      expect(result).toEqual({
        stdout: expect.any(Array),
        headings: [heading(onlyReplaced), heading(inBoth), heading(failingFile(1)), ...flakyHeadings],
        notes: [note, note],
        stderr: "",
        exitCode: 0,
        requests: { 7: [request(7, 1)], builds: [attempts(7)] },
      });
      expect(result.stdout.slice(0, 4)).toEqual(["build #7  https://buildkite.com/bun/bun/builds/7", "", note, ""]);
      expect(result.stdout.slice(-3)).toEqual(["", note, ""]);
    });

    scenario("--errors leaves nothing out, and says so, when no failure links its job", async () => {
      // A replaced attempt started, so a section can be its own. But the link has a form that the script does
      // not know.
      const unlinked = section(onlyReplaced, 1).replace("https://buildkite.com/bun/bun/builds/7#", "/builds/7#");
      const result = await runFindBuild(["--errors", "a-branch", "--no-compare"], {
        annotations: { 7: [{ ...failing(onlyReplaced), body_html: unlinked }] },
        lists: { "a-branch": [byNumber] },
      });
      const note = "(replaced job attempts are not left out: no section of a failure links its job)";
      expect(result).toEqual({
        stdout: expect.any(Array),
        headings: [heading(onlyReplaced)],
        notes: [note, note],
        stderr: "",
        exitCode: 0,
        requests: { 7: [request(7, 1)], builds: [newest("a-branch")] },
      });
    });

    scenario("--errors names each file that only a replaced attempt reported on", async () => {
      const result = await runFindBuild(["--errors", "7", "--no-compare"], {
        annotations: { 7: [failedIn(onlyReplaced, 1), failedIn(failingFile(2), 1)] },
        builds: [byNumber],
      });
      expect(result).toEqual({
        stdout: [
          "build #7  https://buildkite.com/bun/bun/builds/7",
          "",
          leftOut,
          "no error annotations",
          "",
          replacedOnly(onlyReplaced),
          replacedOnly(failingFile(2)),
          "",
          leftOut,
          "",
        ],
        headings: [replacedOnly(onlyReplaced), replacedOnly(failingFile(2))],
        notes: [leftOut, leftOut],
        stderr: "",
        exitCode: 0,
        requests: { 7: [request(7, 1)], builds: [attempts(7)] },
      });
    });

    // `--errors` lists a warning only with `--all`, so it names one that is left out only with `--all` too.
    const warning: Annotation = { ...failedIn("a warning of a build step", 1), id: "warning", style: "warning" };
    const alls: { how: string; args: string[]; rest: string[] }[] = [
      { how: "does not name", args: [], rest: ["no error annotations", ""] },
      {
        how: "--all names",
        args: ["--all"],
        rest: [
          "no error annotations",
          "",
          replacedOnly("a warning of a build step"),
          "",
          "(1 section of 1 replaced job attempt left out)",
          "",
        ],
      },
    ];
    scenario.each(alls)("--errors $how a warning that only a replaced attempt wrote", async ({ args, rest }) => {
      const result = await runFindBuild(["--errors", "7", "--no-compare", ...args], {
        annotations: { 7: [warning] },
        builds: [byNumber],
      });
      const note = "(1 section of 1 replaced job attempt left out)";
      expect(result.stdout).toEqual(["build #7  https://buildkite.com/bun/bun/builds/7", "", note, ...rest]);
    });

    // The job that replaces an attempt runs the same files. The test runner exits with 0 or 2 when it ended by
    // itself. After any other end, what the replaced attempt reported can be the only report on a file, so a
    // line names the job.
    const ends: { end: string; latest: object | null; line: string }[] = [
      { end: "passed", latest: {}, line: "" },
      { end: "ended by itself with failures", latest: { state: "failed", exit_status: 2 }, line: "" },
      {
        end: "lost its agent too",
        latest: { state: "failed", exit_status: -1 },
        line: unfinished(2, "(failed, exit -1)", 1),
      },
      {
        end: "failed outside the runner",
        latest: { state: "failed", exit_status: 1 },
        line: unfinished(2, "(failed, exit 1)", 1),
      },
      {
        end: "was canceled",
        latest: { state: "canceled", exit_status: null },
        line: unfinished(2, "(canceled)", 1),
      },
      { end: "still runs", latest: { state: "running", exit_status: null }, line: unfinished(2, "(running)", 1) },
      {
        end: "is not among the jobs",
        latest: null,
        line: `  The latest attempt did not finish: lane 2 - test-bun (not in the list of jobs), replaced ${jobUrl(1)}`,
      },
    ];
    scenario.each(ends)("--errors leaves its sections out when the latest attempt $end", async ({ latest, line }) => {
      const result = await runFindBuild(["--errors", "7", "--no-compare"], {
        annotations,
        builds: [buildOf("a-branch", 7, [lost(1, 2), ...(latest ? [attempt(2, latest)] : []), ranOnce])],
      });
      const notes = line ? [leftOut, line] : [leftOut];
      expect(result).toEqual({
        stdout: expect.any(Array),
        headings: live,
        notes: [...notes, ...notes],
        stderr: "",
        exitCode: 0,
        requests: { 7: [request(7, 1)], builds: [attempts(7)] },
      });
    });

    scenario("--errors names each job whose latest attempt did not finish, also when two have one name", async () => {
      // Two shards of one lane. The API gives both the name of the lane.
      const shards = [
        lost(1, 2, {}, 0),
        attempt(2, { state: "running", exit_status: null }, 0),
        lost(4, 5, {}, 0),
        attempt(5, { state: "canceled", exit_status: null }, 0),
      ];
      const result = await runFindBuild(["--errors", "7", "--no-compare"], {
        annotations: { 7: [failedIn(onlyReplaced, 1), failedIn(failingFile(2), 4)] },
        builds: [buildOf("a-branch", 7, shards)],
      });
      const line = (latest: number, state: string, replaced: number) =>
        unfinished(latest, state, replaced).replace(`lane ${latest} `, "lane 0 ");
      const notes = [
        "(2 sections of 2 replaced job attempts left out)",
        line(2, "(running)", 1),
        line(5, "(canceled)", 4),
      ];
      expect(result).toEqual({
        stdout: expect.any(Array),
        headings: [replacedOnly(onlyReplaced), replacedOnly(failingFile(2))],
        notes: [...notes, ...notes],
        stderr: "",
        exitCode: 0,
        requests: { 7: [request(7, 1)], builds: [attempts(7)] },
      });
    });

    // A build step is not the test runner: when it fails and keeps its agent, it ended by itself.
    const step = { name: "lane - build-bun", command: "node scripts/build.ts --profile=ci-build" };
    const stepEnds: { end: string; latest: object; line: string }[] = [
      { end: "failed again", latest: { state: "failed", exit_status: 1 }, line: "" },
      {
        end: "lost its agent",
        latest: { state: "failed", exit_status: -1 },
        line: unfinished(2, "(failed, exit -1)", 1).replace("lane 2 - test-bun", step.name),
      },
    ];
    scenario.each(stepEnds)(
      "--errors --all leaves out what a replaced attempt of a build step reported, when the step then $end",
      async ({ latest, line }) => {
        // The step failed, and someone ran it again.
        const steps = [
          attempt(1, { ...step, state: "failed", exit_status: 1, retried: true, retried_in_job_id: jobId(2) }),
          attempt(2, { ...step, ...latest }),
        ];
        const compileError = "[E0425] cannot find value `x` in this scope";
        const outside = {
          ...failedIn("step failed outside runner", 1),
          id: "outside",
          context: "step-failed-outside-runner",
        };
        const result = await runFindBuild(["--errors", "7", "--no-compare", "--all"], {
          annotations: { 7: [failedIn(compileError, 1, 2), outside, binarySize] },
          builds: [buildOf("a-branch", 7, steps)],
        });
        const notes = line ? [leftOut, line] : [leftOut];
        expect(result).toEqual({
          stdout: expect.any(Array),
          headings: [heading(compileError), heading("binary-size"), replacedOnly("step-failed-outside-runner")],
          notes: [...notes, ...notes],
          stderr: "",
          exitCode: 0,
          requests: { 7: [request(7, 1)], builds: [attempts(7)] },
        });
        expect(printed(result.stdout)).toEqual(["attempt 2: 1 fail"]);
      },
    );

    scenario("--errors leaves out nothing, and says nothing, when only a flaky section names no job", async () => {
      // A replaced attempt started. The one section is of a file that failed in the parallel batch: no failure.
      const result = await runFindBuild(["--errors", "a-branch", "--no-compare"], {
        annotations: { 7: [flaky(inBatch)] },
        lists: { "a-branch": [byNumber] },
      });
      expect(result).toEqual({
        stdout: expect.any(Array),
        headings: [heading(inBatch, " [flaky]")],
        notes: [],
        stderr: "",
        exitCode: 0,
        requests: { 7: [request(7, 1)], builds: [newest("a-branch")] },
      });
    });

    const compared = "compared with main #6 (1 failing), #5 (0 failing)";
    scenario("--errors asks once for a build number: for its branch, and for its job attempts", async () => {
      const result = await runFindBuild(["--errors", "7"], {
        main: [onMain(6), onMain(5)],
        annotations: { ...annotations, 6: [failing(inBoth)], 5: [] },
        builds: [byNumber],
      });
      expect(result).toEqual({
        stdout: expect.any(Array),
        // No tag from main for the file that only the replaced attempt reported on.
        headings: [
          heading(failingFile(1), " [new]"),
          heading(inBoth, " [pre-existing]"),
          ...flakyHeadings,
          replacedOnly(onlyReplaced),
        ],
        notes: [compared, leftOut, leftOut],
        stderr: "",
        exitCode: 0,
        requests: { 7: [request(7, 1)], 6: [names(6, 1)], 5: [names(5, 1)], builds: [attempts(7), complete] },
      });
    });

    scenario("--errors counts every attempt of a build of main", async () => {
      // In build 6 of main, only a replaced attempt failed the file. Main can fail it, so it is `[pre-existing]`.
      const result = await runFindBuild(["--errors", "a-branch"], {
        main: [onMain(6), onMain(5)],
        annotations: {
          7: [failedIn(inBoth, 3)],
          6: [{ ...failing(inBoth), body_html: section(inBoth, 1, 6) }],
          5: [],
        },
        lists: { "a-branch": [byNumber] },
        builds: [{ ...onMain(6), jobs: every }],
      });
      expect(result).toEqual({
        stdout: expect.any(Array),
        headings: [heading(inBoth, " [pre-existing]")],
        notes: [compared],
        stderr: "",
        exitCode: 0,
        // The names of the annotations of build 6, and nothing about its jobs.
        requests: {
          7: [request(7, 1)],
          6: [names(6, 1)],
          5: [names(5, 1)],
          builds: [newest("a-branch"), complete],
        },
      });
    });

    scenario(
      "--errors counts the annotations that it read, not the ones that it prints, when the list is cut",
      async () => {
        const result = await runFindBuild(["--errors", "7", "--no-compare"], {
          annotations: { 7: [failedIn(onlyReplaced, 1), ...failingFiles(229)] },
          builds: [byNumber],
        });
        const note = "(1 section of 1 replaced job attempt left out)";
        expect(result).toEqual({
          stdout: expect.any(Array),
          headings: [...failingHeadings(199), replacedOnly(onlyReplaced)],
          notes: [cutNote, note, cutNote, note],
          stderr: "",
          exitCode: 0,
          requests: { 7: [request(7, 1), request(7, 2), after200(7)], builds: [attempts(7)] },
        });
      },
    );

    // What the runner wrote in build 137256 and what Buildkite made of it, with the output cut. Two shards lost
    // their agent (exit -1). Each retry passed.
    const recorded = {
      lost: ["01a1a1ba-b1fe-435f-a6ed-805aeada2743", "01a1a1ba-b21b-49b2-b096-e7a832a23e4a"],
      retries: ["01a1a1ce-d009-4ab6-ae10-004d2721d467", "01a1a1d2-0e69-4e77-8850-71ac0ef393dd"],
      ranOnce: "01a1a160-bc7e-4990-9620-00ab5993c593",
      compile: "test/aot/parallel/globals/worker-globals/main.mjs",
      driver: "test/aot/parallel/async/a-copy-of-the-argument-is-read-in-the-last-case-behind-many-awaits-verified.",
      live: "test/aot/engine/ir-1.test.ts",
      url: (job: string) => `https://buildkite.com/bun/bun/builds/137256#${job}`,
    };
    const recordedJob = (id: string, rest: object) => ({
      id,
      type: "script",
      name: ":darwin: any x64 - test-bun",
      command:
        "./scripts/runner.node.mjs --step=darwin-x64-build-bun --exclude=integration/bun-types --exclude=internal/source-lints",
      started_at: "2026-11-03T14:26:08.218Z",
      web_url: recorded.url(id),
      ...rest,
    });
    const recordedJobs = [
      recordedJob(recorded.ranOnce, { name: ":debian: 13 aarch64 - test-bun", state: "failed", exit_status: 2 }),
      ...recorded.lost.map((id, i) =>
        recordedJob(id, { state: "failed", exit_status: -1, retried: true, retried_in_job_id: recorded.retries[i] }),
      ),
      ...recorded.retries.map(id => recordedJob(id, { state: "passed", exit_status: 0 })),
    ];
    const source = "https://github.com/oven-sh/bun/blob/aaacd8ad9409e203aa065a7b69707587a31efd19";
    const mac =
      '<img class="emoji" title="mac" alt=":darwin:" src="https://buildkiteassets.com/emojis/img-buildkite-64/mac.png" draggable="false"> any x64';
    const debian =
      '<img class="emoji" title="debian" alt=":debian:" src="https://buildkiteassets.com/emojis/img-buildkite-64/debian.png" draggable="false"> 13 aarch64';
    const recordedAnnotations: Annotation[] = [
      {
        id: "01a1a1ce-9f6b-4913-bee9-d4ee9d71381f",
        context: recorded.compile,
        style: "error",
        body_html:
          `<details><summary><a href="${source}/${recorded.compile}"><code>${recorded.compile}</code></a> - compile: the build ended with exit code 1 on <a href="${recorded.url(recorded.lost[0])}">${mac}</a></summary>\n` +
          `<pre class="term"><code>error: failed to get the current directory</code></pre>\n</details>\n`,
      },
      {
        id: "01a1a1ce-a88e-44fb-ad68-1790716c9e7f",
        context: recorded.driver,
        style: "error",
        body_html:
          `<details><summary><a href="${source}/${recorded.driver}ts"><code>${recorded.driver}ts</code></a> - driver: test/aot/run-parallel.ts ended without a result for it on <a href="${recorded.url(recorded.lost[1])}">${mac}</a></summary>\n` +
          `<pre class="term"><code>bun test/aot/run-parallel.ts</code></pre>\n</details>\n`,
      },
      {
        id: "01a1a16d-0ca8-4ae5-9914-c24046b32db8",
        context: recorded.live,
        style: "error",
        body_html:
          `<details><summary><a href="${source}/${recorded.live}"><code>${recorded.live}</code></a> - code 1 on <a href="${recorded.url(recorded.ranOnce)}">${debian}</a></summary>\n` +
          `<pre class="term"><code>1 fail</code></pre>\n</details>\n`,
      },
    ];
    scenario("--errors leaves out the sections that two lost agents wrote in build 137256", async () => {
      const result = await runFindBuild(["--errors", "137256", "--no-compare"], {
        annotations: { 137256: recordedAnnotations },
        builds: [buildOf("robobun/c3116916/line-scan-stepper", 137256, recordedJobs)],
      });
      const note = "(2 sections of 2 replaced job attempts left out)";
      expect(result).toEqual({
        stdout: expect.any(Array),
        headings: [heading(recorded.live), replacedOnly(recorded.compile), replacedOnly(recorded.driver)],
        notes: [note, note],
        stderr: "",
        exitCode: 0,
        requests: { 137256: [request(137256, 1)], builds: [attempts(137256)] },
      });
    });

    test("scripts/buildkite.ts links a job in the form that these sections have", async () => {
      const writer = join(import.meta.dir, "..", "..", "scripts", "buildkite.ts");
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `import { getBuildUrl } from ${JSON.stringify(writer)}; console.log(String(getBuildUrl()));`,
        ],
        env: {
          ...bunEnv,
          BUILDKITE: "true",
          BUILDKITE_BUILD_URL: "https://buildkite.com/bun/bun/builds/7",
          BUILDKITE_JOB_ID: jobId(1),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: jobUrl(1) + "\n", stderr: "", exitCode: 0 });
    });

    // How the replaced attempt ended changes nothing: its job ran again, and the latest attempt passed.
    const replacedEnds: { end: string; rest: object }[] = [
      { end: "lost its agent", rest: { state: "failed", exit_status: -1 } },
      { end: "ran every file, failed, and was run again by hand", rest: { state: "failed", exit_status: 2 } },
      { end: "failed outside the runner", rest: { state: "failed", exit_status: 1 } },
    ];
    describe.each(replacedEnds)("that $end", ({ rest }) => {
      const jobs = [lost(1, 2, rest), attempt(2), ranOnce];
      const errors: { target: string; canned: Partial<Canned>; builds: string }[] = [
        { target: "7", canned: { builds: [buildOf("a-branch", 7, jobs)] }, builds: attempts(7) },
        {
          target: "a-branch",
          canned: { lists: { "a-branch": [buildOf("a-branch", 7, jobs)] } },
          builds: newest("a-branch"),
        },
      ];
      scenario.each(errors)("is left out of --errors $target", async ({ target, canned, builds }) => {
        const result = await runFindBuild(["--errors", target, "--no-compare"], { annotations, ...canned });
        expect(result).toEqual({
          stdout: expect.any(Array),
          headings: live,
          notes: [leftOut, leftOut],
          stderr: "",
          exitCode: 0,
          requests: { 7: [request(7, 1)], builds: [builds] },
        });
      });

      scenario("is left out of --status", async () => {
        const result = await runFindBuild(["--status", "7"], {
          annotations,
          builds: [{ ...buildOf("a-branch", 7, jobs), started_at: null, finished_at: "2999-01-01T00:00:00Z" }],
        });
        expect(result).toEqual({
          stdout: expect.arrayContaining([`  ${inBoth}`, `  ${failingFile(1)}`, `  ${leftOut}`]),
          headings: [],
          notes: [],
          stderr: "",
          exitCode: 0,
          requests: { 7: [names(7, 1), request(7, 1)], builds: [attempts(7)] },
        });
        expect(result.stdout).not.toContain(`  ${onlyReplaced}`);
      });
    });

    describe("--status and --watch", () => {
      /** Build 7, finished, with every attempt of its jobs. */
      const build7 = (state: string, jobs: object[]) => ({
        ...buildOf("a-branch", 7, jobs),
        state,
        started_at: null,
        finished_at: "2999-01-01T00:00:00Z",
      });
      const top = (state: string) => [
        `#7 ${state}  https://buildkite.com/bun/bun/builds/7`,
        "started - ago, finished 0s ago",
        "",
      ];
      // Job 3 failed. The replaced attempt 1 failed too, and it is not a job of the build.
      const jobs = [
        "jobs: 1 passed, 1 failed  (2 total)",
        "",
        "failed jobs:",
        `  ${"lane 3 - test-bun".padEnd(48)} ${jobUrl(3)}`,
        "",
      ];

      scenario("--status reads only the names when Buildkite replaced no job attempt", async () => {
        const result = await runFindBuild(["--status", "7"], {
          builds: [build7("failed", [attempt(2), ranOnce])],
          annotations: { 7: [failedIn(inBoth, 2, 3), failing(failingFile(1))] },
        });
        expect(result).toEqual({
          stdout: [...top("failed"), ...jobs, "failing tests so far:", `  ${inBoth}`, `  ${failingFile(1)}`, ""],
          headings: [],
          notes: [],
          stderr: "",
          exitCode: 0,
          requests: { 7: [names(7, 1)], builds: [attempts(7)] },
        });
      });

      scenario("--status reads only the names when the replaced attempt did not start", async () => {
        const result = await runFindBuild(["--status", "7"], {
          builds: [build7("failed", [expired(1, 2), attempt(2), ranOnce])],
          annotations: { 7: [notice, failedIn(inBoth, 2, 3)] },
        });
        expect(result).toEqual({
          // As `--errors` does, it names the file of the section that names that attempt.
          stdout: [...top("failed"), ...jobs, "failing tests so far:", "  robobun", `  ${inBoth}`, ""],
          headings: [],
          notes: [],
          stderr: "",
          exitCode: 0,
          requests: { 7: [names(7, 1)], builds: [attempts(7)] },
        });
      });

      scenario("--status reads the bodies when a replaced attempt started, and leaves its sections out", async () => {
        const result = await runFindBuild(["--status", "7"], { builds: [build7("failed", every)], annotations });
        expect(result).toEqual({
          stdout: [
            ...top("failed"),
            ...jobs,
            "failing tests so far:",
            `  ${inBoth}`,
            `  ${failingFile(1)}`,
            "  (+1 warning/flaky)",
            `  ${leftOut}`,
            "",
          ],
          headings: [],
          notes: [],
          stderr: "",
          exitCode: 0,
          requests: { 7: [names(7, 1), request(7, 1)], builds: [attempts(7)] },
        });
      });

      const passed = build7("passed", [lost(1, 2), attempt(2)]);
      const onlyStale = { 7: [failedIn(onlyReplaced, 1)] };
      const oneLeftOut = "  (1 section of 1 replaced job attempt left out)";
      scenario.each(["--status", "--watch"])(
        "%s says `no failures` when only a replaced attempt reported, and the build passed",
        async command => {
          const result = await runFindBuild([command, "7"], { builds: [passed], annotations: onlyStale });
          expect(result).toEqual({
            stdout: [...top("passed"), "jobs: 1 passed  (1 total)", oneLeftOut, "", "no failures", ""],
            headings: [],
            notes: [],
            stderr: "",
            exitCode: 0,
            requests: { 7: [names(7, 1), request(7, 1)], builds: [attempts(7)] },
          });
        },
      );

      // A canceled job is not a failed job, so the list of failed jobs is empty.
      const canceled = attempt(2, { state: "canceled", exit_status: null });
      scenario("--status does not say `no failures` for a build that did not pass", async () => {
        const result = await runFindBuild(["--status", "7"], {
          builds: [build7("canceled", [canceled])],
          annotations: { 7: [] },
        });
        expect(result).toEqual({
          stdout: [...top("canceled"), "jobs: 1 canceled  (1 total)", ""],
          headings: [],
          notes: [],
          stderr: "",
          exitCode: 0,
          requests: { 7: [names(7, 1)], builds: [attempts(7)] },
        });
      });

      scenario("--status names the job whose latest attempt did not finish", async () => {
        const result = await runFindBuild(["--status", "7"], {
          builds: [build7("canceled", [lost(1, 2), canceled])],
          annotations: onlyStale,
        });
        expect(result).toEqual({
          stdout: [
            ...top("canceled"),
            "jobs: 1 canceled  (1 total)",
            oneLeftOut,
            `  ${unfinished(2, "(canceled)", 1)}`,
            "",
          ],
          headings: [],
          notes: [],
          stderr: "",
          exitCode: 0,
          requests: { 7: [names(7, 1), request(7, 1)], builds: [attempts(7)] },
        });
      });

      scenario("--status names every annotation, and says why, when the request for the bodies fails", async () => {
        const result = await runFindBuild(["--status", "7"], {
          builds: [passed],
          annotations: onlyStale,
          failingCall: request(7, 1),
        });
        expect(result).toEqual({
          stdout: [
            ...top("passed"),
            "jobs: 1 passed  (1 total)",
            "",
            "failing tests so far:",
            `  ${onlyReplaced}`,
            `  (replaced job attempts are not left out: ${failedRequest(request(7, 1))})`,
            "",
          ],
          headings: [],
          notes: [],
          stderr: "",
          exitCode: 0,
          requests: { 7: [names(7, 1), request(7, 1)], builds: [attempts(7)] },
        });
      });
    });
  });
});
