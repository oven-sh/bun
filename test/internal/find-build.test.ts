import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";

// scripts/find-build.ts asks `bk` for the builds and `gh` for the merged PRs. Here both are shell
// scripts on PATH that record their arguments. `bk api .../annotations` answers as the Buildkite
// REST API does: 30 annotations per page unless `per_page` asks for more, 100 at most, pages count
// from 1, and `omit_body=true` leaves `body_html` out. Shell scripts do not resolve as executables
// on Windows, hence the skip.
describe.skipIf(isWindows)("scripts/find-build.ts with a canned `bk` and `gh`", () => {
  const script = join(import.meta.dir, "..", "..", "scripts", "find-build.ts");
  const fakeGh = ["#!/bin/sh", 'echo "gh $*" >> "$FAKE/calls"', 'cat "$FAKE/merged.json"', ""].join("\n");
  const fakeBk = [
    "#!/bin/sh",
    'echo "bk $*" >> "$FAKE/calls"',
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
    '  "build view") cat "$FAKE/view-$3.json" ;;',
    '  "build list") cat "$FAKE/list-$4.json" ;;',
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

  interface Canned {
    /** `bk api /pipelines/bun/builds/<key>/annotations`, in the order the API lists them. */
    annotations: Record<number, readonly Annotation[]>;
    /** `bk build view <key> --json` */
    views?: Record<number, object>;
    /** `bk build list --branch <key>` */
    lists?: Record<string, readonly { number: number }[]>;
    /** `gh pr list --state merged` */
    merged?: { headRefName: string }[];
    /** The annotations page on which `bk api` fails. */
    failingPage?: number;
    /** An annotation that the build `<key>` gets ahead of its others, after the script read the first page. */
    added?: Record<number, Annotation>;
  }

  async function runFindBuild(
    args: string[],
    { annotations, views = {}, lists = {}, merged = [], failingPage, added = {} }: Canned,
  ) {
    using dir = tempDir("find-build", {
      "bin/gh": fakeGh,
      "bin/bk": fakeBk,
      "calls": "",
      "merged.json": JSON.stringify(merged),
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
      ...Object.fromEntries(Object.entries(views).map(([build, view]) => [`view-${build}.json`, JSON.stringify(view)])),
      ...Object.fromEntries(
        Object.entries(lists).map(([branch, builds]) => [`list-${branch}.json`, JSON.stringify(builds)]),
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
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stdout.split("\n");
    // The script reads several builds at the same time, and the pages of one build one after the other.
    const requests: Record<string, readonly string[]> = {};
    for (const call of readFileSync(join(String(dir), "calls"), "utf8").split("\n")) {
      const build = call.match(/^bk api \/pipelines\/bun\/builds\/(\d+)\//)?.[1];
      if (build) requests[build] = [...(requests[build] ?? []), call];
    }
    return {
      stdout: lines,
      /** The `== <context> ==` line above each annotation that `--errors` prints. */
      headings: lines.filter(line => line.startsWith("== ")),
      /** The lines of `--errors` that say that the list is cut. */
      notes: lines.filter(line => line.startsWith("(only the first ")),
      stderr,
      exitCode,
      /** The `bk api` calls for each build, in the order the script made them. */
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
    const build7 = [
      failing(failingFile(5)),
      failing(failingFile(120)),
      failing(failingFile(220)),
      failing(onThisBranch),
    ];

    scenario("tags with every annotation of a merged PR's build, read without the bodies", async () => {
      const result = await runFindBuild(["--errors", "7"], {
        merged: [{ headRefName: "merged-pr" }],
        lists: { "merged-pr": [{ number: 8 }] },
        annotations: { 7: build7, 8: failingFiles(230) },
      });
      expect(result).toEqual({
        stdout: expect.any(Array),
        headings: [
          heading(onThisBranch, " [new]"),
          heading(failingFile(5), " [pre-existing]"),
          heading(failingFile(120), " [pre-existing]"),
          heading(failingFile(220), " [pre-existing]"),
        ],
        notes: [],
        stderr: "",
        exitCode: 0,
        requests: { 7: [request(7, 1)], 8: [names(8, 1), names(8, 2), names(8, 3)] },
      });
    });

    // With a part of the merged PRs' failures, the others would get the tag `[new]`.
    const failures: { failure: string; canned: Partial<Canned>; requests: Record<string, string[]> }[] = [
      {
        failure: "a page of a merged PR's build",
        canned: { lists: { "merged-pr": [{ number: 8 }] }, failingPage: 2 },
        requests: { 7: [request(7, 1)], 8: [names(8, 1), names(8, 2)] },
      },
      {
        failure: "the list of a merged PR's builds",
        canned: { lists: {} },
        requests: { 7: [request(7, 1)] },
      },
    ];
    scenario.each(failures)("prints no tag when the request for $failure fails", async ({ canned, requests }) => {
      const result = await runFindBuild(["--errors", "7"], {
        merged: [{ headRefName: "merged-pr" }],
        annotations: { 7: build7, 8: failingFiles(230) },
        ...canned,
      });
      expect(result).toEqual({
        stdout: expect.any(Array),
        headings: build7.map(annotation => heading(annotation.context)),
        notes: [],
        stderr: "",
        exitCode: 0,
        requests,
      });
      expect(result.stdout.slice(-3)).toEqual([
        "",
        "(no comparison: could not read the builds of recently merged PRs)",
        "",
      ]);
    });
  });

  describe("--status", () => {
    const view = (state: string, finished_at: string | null) => ({
      state,
      started_at: null,
      finished_at,
      web_url: "https://buildkite.com/bun/bun/builds/7",
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
        views: { 7: view("failed", null) },
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
        requests,
      });
    });

    // The build ends in the future, which prints as `0s ago` whenever the test runs.
    const finished = view("passed", "2999-01-01T00:00:00Z");
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
      const result = await runFindBuild(["--status", "7"], { views: { 7: finished }, ...canned });
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
        requests: { 7: requests },
      });
    });
  });
});
