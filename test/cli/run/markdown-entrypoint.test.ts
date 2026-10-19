import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, rmSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isPosix, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { extname, join } from "path";

// Tracks exit code from the last runMd() call so individual tests can
// assert it after snapshotting stdout (giving a readable diff on failure).
let lastExitCode: number | null = null;

async function runMd(source: string, env: Record<string, string> = {}) {
  using dir = tempDir("md-entry-", { "doc.md": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "./doc.md"],
    env: { ...bunEnv, FORCE_COLOR: "1", TERM: "xterm-256color", ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  // stderr intentionally not asserted: ASAN builds emit a warning there.
  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  lastExitCode = exitCode;
  return stdout;
}

describe("bun <file.md>", () => {
  afterEach(() => {
    // Implicit exit-code assertion for every test that relies on runMd().
    if (lastExitCode !== null) {
      expect(lastExitCode).toBe(0);
      lastExitCode = null;
    }
  });

  test("renders headings with underlines", async () => {
    expect(
      await runMd(["# Heading 1", "", "## Heading 2", "", "### Heading 3", "", "body", ""].join("\n")),
    ).toMatchSnapshot();
  });

  test("renders bold, italic, strikethrough, inline code", async () => {
    expect(await runMd("**bold** *italic* ~~strike~~ `code` regular\n")).toMatchSnapshot();
  });

  test("renders ordered, unordered, and task lists", async () => {
    expect(
      await runMd(
        [
          "1. first",
          "2. second",
          "3. third",
          "",
          "- apple",
          "- banana",
          "- cherry",
          "",
          "- [ ] todo",
          "- [x] done",
          "",
        ].join("\n"),
      ),
    ).toMatchSnapshot();
  });

  test("renders blockquotes and nested blockquotes", async () => {
    expect(await runMd(["> A quote", ">", "> > Nested quote", ""].join("\n"))).toMatchSnapshot();
  });

  test("renders horizontal rules", async () => {
    expect(await runMd(["above", "", "---", "", "below", ""].join("\n"))).toMatchSnapshot();
  });

  test("renders fenced code block with JS syntax highlighting", async () => {
    expect(
      await runMd(["```js", 'const name = "world";', "console.log(`hello ${name}`);", "```", ""].join("\n")),
    ).toMatchSnapshot();
  });

  test("renders fenced code block without language", async () => {
    expect(await runMd(["```", "plain text", "no highlighting", "```", ""].join("\n"))).toMatchSnapshot();
  });

  test("renders link text with url fallback when no TTY", async () => {
    // runMd() spawns Bun with stdout:"pipe", so Output.isStdoutTTY() is
    // false and hyperlinks fall back to `text (url)`. The OSC 8 path fires
    // when stdout really is a TTY.
    expect(await runMd("Visit [Bun](https://bun.com) today.\n")).toMatchSnapshot();
  });

  test("emits OSC 8 escape for links when hyperlinks are enabled", async () => {
    // runMd() pipes stdout so the CLI path can't see a TTY; drive the
    // JS API directly with hyperlinks:true to cover the OSC 8 branch.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.stdout.write(Bun.markdown.ansi("see [Bun](https://bun.com)\\n", { hyperlinks: true }))`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Output must contain the OSC 8 opener + closer around the link.
    expect(stdout).toContain("\x1b]8;;https://bun.com\x1b\\");
    expect(stdout).toContain("\x1b]8;;\x1b\\");
    expect(exitCode).toBe(0);
  });

  test("renders link with text + url pair fallback", async () => {
    expect(await runMd("see [Bun](https://bun.com)\n")).toMatchSnapshot();
  });

  test("renders images as alt text with link", async () => {
    expect(await runMd("![an image](https://bun.com/logo.png)\n")).toMatchSnapshot();
  });

  test("renders wikilinks", async () => {
    expect(await runMd("see [[SomePage]] for more\n")).toMatchSnapshot();
  });

  // Regression: the parser's `[[` fast-path used to skip emitting the
  // preceding text when the wikilink failed to close. `foo [[bar baz`
  // should render the full text literally, not drop the `foo ` prefix.
  test("falls back to literal text when `[[` never closes", async () => {
    expect(await runMd("foo [[bar baz\n")).toMatchSnapshot();
  });

  test("renders simple table with alignment", async () => {
    expect(
      await runMd(
        [
          "| Name  | Age | City |",
          "|:------|:---:|-----:|",
          "| Alice |  30 |  NYC |",
          "| Bob   |  25 |   LA |",
          "",
        ].join("\n"),
      ),
    ).toMatchSnapshot();
  });

  test("renders table with CJK multi-width graphemes", async () => {
    expect(
      await runMd(
        [
          "| 名前   | 言語       | 都市       |",
          "|:-------|:----------:|-----------:|",
          "| 山田   | 日本語     | 東京       |",
          "| Alice  | English    | NYC        |",
          "",
        ].join("\n"),
      ),
    ).toMatchSnapshot();
  });

  test("renders table with emoji graphemes", async () => {
    expect(
      await runMd(
        [
          "| Status | Label  |",
          "|:------:|:-------|",
          "| ✅     | pass   |",
          "| ❌     | fail   |",
          "| 🚀     | launch |",
          "",
        ].join("\n"),
      ),
    ).toMatchSnapshot();
  });

  test("renders combining characters without breaking alignment", async () => {
    // Decomposed NFD: 'e' + U+0301 combining acute, 'i' + U+0308 combining diaeresis.
    // These must be zero-width in the grapheme counter for the table to line up.
    const stdout = await runMd(
      ["| Name   | Note |", "|:-------|:-----|", "| cafe\u0301   | hot  |", "| nai\u0308ve  | ok   |", ""].join("\n"),
    );
    expect(stdout).toMatchSnapshot();
    expect(lastExitCode).toBe(0);
  });

  test("renders inline formatting inside table cells", async () => {
    const stdout = await runMd(
      [
        "| Name  | Style     |",
        "|:------|:----------|",
        "| **Alice** | *editor* |",
        "| `bob` | [link](https://bun.com) |",
        "",
      ].join("\n"),
    );
    expect(stdout).toMatchSnapshot();
    expect(lastExitCode).toBe(0);
  });

  test("renders inline formatting inside headings", async () => {
    const stdout = await runMd("# Hello **bold** and *italic* heading\n");
    expect(stdout).toMatchSnapshot();
    expect(lastExitCode).toBe(0);
  });

  test("nested code span inside bold keeps outer bold", async () => {
    const stdout = await runMd("**before `code` after** tail\n");
    expect(stdout).toMatchSnapshot();
    expect(lastExitCode).toBe(0);
  });

  test("renders mixed inline styles with autolinks", async () => {
    expect(await runMd("Check **https://bun.com** and <me@example.com>!\n")).toMatchSnapshot();
  });

  test("renders nested lists", async () => {
    expect(
      await runMd(["- outer", "  - inner 1", "  - inner 2", "    - deep", "- second outer", ""].join("\n")),
    ).toMatchSnapshot();
  });

  test("runs without colors when NO_COLOR is set", async () => {
    using dir = tempDir("md-no-color-", {
      "doc.md": "# Hello\n\n**world**\n",
    });
    const env: NodeJS.Dict<string> = { ...bunEnv, NO_COLOR: "1" };
    // FORCE_COLOR set to anything (even "") forces colors on, so drop it.
    delete env.FORCE_COLOR;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "./doc.md"],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // No escape characters expected
    expect(stdout).not.toContain("\x1b[");
    expect(stdout).toMatchSnapshot();
    expect(exitCode).toBe(0);
  });

  test("renders via `bun run ./file.md`", async () => {
    using dir = tempDir("md-run-", { "doc.md": "# Title\n\nbody\n" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "./doc.md"],
      env: { ...bunEnv, FORCE_COLOR: "1", TERM: "xterm-256color" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toMatchSnapshot();
    expect(exitCode).toBe(0);
  });

  test("renders .markdown extension too", async () => {
    using dir = tempDir("md-ext-", { "doc.markdown": "# yep\n" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "./doc.markdown"],
      env: { ...bunEnv, FORCE_COLOR: "1", TERM: "xterm-256color" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toMatchSnapshot();
    expect(exitCode).toBe(0);
  });

  // Every emitted line must fit the terminal — checked via Bun.stringWidth
  // (visible width, ANSI-stripped) so escape sequences don't inflate the
  // count.
  function maxLineWidth(out: string): number {
    return Math.max(0, ...out.split("\n").map(l => Bun.stringWidth(l)));
  }

  test("wraps inline code spans within COLUMNS, never mid-word", async () => {
    const out = await runMd(
      "After modifying `coreBeeps.ts`, `controlBoops.ts`, or `toolBoops.ts`, run " +
        "`bun run build:boop` to regenerate. **Do not edit `*.generated.ts` files directly.**\n",
      { COLUMNS: "45" },
    );
    expect(maxLineWidth(out)).toBeLessThanOrEqual(45);
    expect(out).toMatchSnapshot();
  });

  test("hard-breaks an overlong CJK word at the visible-width boundary", async () => {
    // 60 bytes = 20 CJK chars = 40 visible columns; must wrap at 30.
    const out = await runMd("A " + Buffer.alloc(60, "测试").toString() + " wide.\n", { COLUMNS: "30" });
    expect(out).not.toContain("\uFFFD");
    expect(maxLineWidth(out)).toBeLessThanOrEqual(30);
    expect(out).toMatchSnapshot();
  });

  test("shrinks table columns to fit COLUMNS and wraps cell content", async () => {
    const out = await runMd(
      [
        "| Path | Scope |",
        "| --- | --- |",
        "| `docs/guide.md` | Top-level architecture: module map, startup flow, state management |",
        "| `docs/components/design-system/guide.md` | Design system component API (Dialog, Tabs, StatusIcon, etc.) |",
        "",
      ].join("\n"),
      { COLUMNS: "50" },
    );
    expect(maxLineWidth(out)).toBeLessThanOrEqual(50);
    // Borders stay aligned: every non-blank line starts and ends with `│`
    // (or the matching corner/junction char for the top/bottom/separator).
    for (const line of out.split("\n")) {
      if (line.trim().length === 0) continue;
      const stripped = Bun.stripANSI(line);
      expect(
        stripped.startsWith("│") || stripped.startsWith("┌") || stripped.startsWith("├") || stripped.startsWith("└"),
      ).toBe(true);
      expect(stripped.endsWith("│") || stripped.endsWith("┐") || stripped.endsWith("┤") || stripped.endsWith("┘")).toBe(
        true,
      );
    }
    expect(out).toMatchSnapshot();
  });

  // Regression: the row-wrapper's word-break refinement used a raw byte
  // scan for the last space inside the cut, which found spaces inside an
  // OSC 8 URL (e.g. `[text](<https://host/my file.png>)`) and truncated
  // the escape sequence mid-URL, corrupting every subsequent row.
  //
  // Triggering this needs the URL space to be the ONLY space in the
  // refinement window: the link is the first content in the cell and is
  // followed by unbreakable text (no literal spaces) that forces a wrap
  // BEFORE any external space appears — so lastIndexOfChar(' ') has
  // nothing else to return.
  test("table link with space in URL keeps OSC 8 sequences intact", () => {
    const source = "| Col |\n" + "|---|\n" + "| [c](<https://host/my file.png>)longunbreakabletailtextxx |\n";
    const out = Bun.markdown.ansi(source, { hyperlinks: true, columns: 25 });
    // Full URL (including the space) must survive inside the opener.
    expect(out).toContain("\x1b]8;;https://host/my file.png\x1b\\");
    // Every OSC 8 opener must have its own ST before the next one starts
    // — a truncation would leave an opener dangling.
    let i = 0;
    let openers = 0;
    while (true) {
      const open = out.indexOf("\x1b]8;;", i);
      if (open === -1) break;
      openers++;
      const close = out.indexOf("\x1b\\", open);
      expect(close).not.toBe(-1);
      const nextOpen = out.indexOf("\x1b]8;;", open + 5);
      if (nextOpen !== -1) expect(close).toBeLessThan(nextOpen);
      i = close + 2;
    }
    expect(openers).toBeGreaterThanOrEqual(2);
  });

  test.skipIf(!isPosix || !(isDebug || isASAN))(
    "prefetched remote images are staged into fresh temp files and never written through a pre-existing entry at the staged path",
    async () => {
      const payload = Buffer.alloc(256, "z");
      await using server = Bun.serve({
        port: 0,
        fetch() {
          return new Response(payload, { headers: { "content-type": "image/png" } });
        },
      });
      using dir = tempDir("md-remote-img-", {
        "doc.md": `![img](http://127.0.0.1:${server.port}/img.png)\n`,
        "tmp/decoy": "keep",
      });
      const tmp = join(String(dir), "tmp");
      const decoy = join(tmp, "decoy");
      const env = {
        ...bunEnv,
        FORCE_COLOR: "1",
        TERM: "xterm-kitty",
        KITTY_WINDOW_ID: "1",
        BUN_DEBUG_HASH_RANDOM_SEED: "42",
        BUN_TMPDIR: tmp,
        TMPDIR: tmp,
      };

      async function runOnce() {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "./doc.md"],
          env,
          cwd: String(dir),
          terminal: { cols: 80, rows: 24, data() {} },
        });
        const exitCode = await proc.exited;
        proc.terminal?.close();
        return exitCode;
      }

      const firstExit = await runOnce();
      const staged = readdirSync(tmp).filter(n => n.startsWith("bun-md-"));
      expect(staged.length).toBe(1);
      expect(staged[0].endsWith(".png")).toBe(true);
      expect(readFileSync(join(tmp, staged[0])).equals(payload)).toBe(true);
      expect(firstExit).toBe(0);

      rmSync(join(tmp, staged[0]));
      symlinkSync(decoy, join(tmp, staged[0]));

      const secondExit = await runOnce();
      expect(readFileSync(decoy, "utf8")).toBe("keep");
      expect(readdirSync(tmp).sort()).toEqual([staged[0], "decoy"].sort());
      expect(secondExit).toBe(0);
    },
  );
});

// The limits `prefetch_remote_images` (src/runtime/cli/run_command.rs) puts on the remote
// images of one document: REMOTE_IMAGE_DEADLINE and REMOTE_IMAGE_BYTE_BUDGET.
const REMOTE_IMAGE_DEADLINE = 3_000;
const REMOTE_IMAGE_BYTE_BUDGET = 64 * 1024 * 1024;

const FIRST_LINE = "first line of the document";
const LAST_LINE = "last line of the document";

/**
 * Renders a document with `bun ./doc.md` on a terminal that speaks the Kitty graphics
 * protocol. There bun downloads the `http(s)` images of the document before it prints
 * the first line. `images` is a list of `[alt text, url]`.
 */
async function renderOnKitty(
  images: [alt: string, url: string][],
  options: {
    env?: Record<string, string>;
    /** A paragraph after the images. */
    text?: string;
    /** Runs while bun renders. */
    meanwhile?: (terminal: Bun.Terminal, proc: Bun.Subprocess) => Promise<void>;
  } = {},
) {
  const doc = [
    `# ${FIRST_LINE}`,
    ...images.map(([alt, url]) => `![${alt}](${url})`),
    ...(options.text ? [options.text] : []),
    LAST_LINE,
    "",
  ].join("\n\n");
  using dir = tempDir("md-remote-img-", { "doc.md": doc, "tmp/keep": "" });
  const tmp = join(String(dir), "tmp");
  const decoder = new TextDecoder();
  let output = "";
  // Settles when the whole document is on the terminal, or at the terminal's EOF,
  // which comes after the last byte the child wrote.
  const rendered = Promise.withResolvers<void>();
  await using terminal = new Bun.Terminal({
    cols: 80,
    rows: 24,
    data(_terminal, chunk) {
      output += decoder.decode(chunk, { stream: true });
      if (output.includes(LAST_LINE)) rendered.resolve();
    },
    exit() {
      rendered.resolve();
    },
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "./doc.md"],
    env: {
      ...bunEnv,
      FORCE_COLOR: "1",
      TERM: "xterm-kitty",
      KITTY_WINDOW_ID: "1",
      BUN_TMPDIR: tmp,
      TMPDIR: tmp,
      ...options.env,
    },
    cwd: String(dir),
    terminal,
  });
  await options.meanwhile?.(terminal, proc);
  await rendered.promise;
  const exitCode = await proc.exited;
  const text = Bun.stripANSI(output);
  // The staged files by extension. bun takes the extension of a staged file from the
  // URL of its image, and the bytes from the body.
  const staged: Record<string, Buffer[]> = {};
  for (const name of readdirSync(tmp)
    .filter(name => name.startsWith("bun-md-"))
    .sort()) {
    (staged[extname(name)] ??= []).push(readFileSync(join(tmp, name)));
  }
  return {
    printed: [FIRST_LINE, LAST_LINE].filter(line => text.includes(line)),
    // An image that bun did not download renders as its alt text.
    altTexts: images.map(([alt]) => alt).filter(alt => text.includes(alt)),
    staged,
    exitCode,
    // `null`: the child exited on its own.
    signalCode: proc.signalCode,
  };
}

describe.concurrent("bun <file.md> remote images", () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const asPng = { headers: { "content-type": "image/png" } };
  const silent = () => new Promise<Response>(() => {});
  // Bun.serve closes a connection that is idle for 10 seconds by default. These hosts never do.
  const quietHost = { port: 0, hostname: "127.0.0.1", idleTimeout: 0 };
  const printed = [FIRST_LINE, LAST_LINE];
  // For the tests in which bun waits out REMOTE_IMAGE_DEADLINE: a debug build does not fit
  // that and its own startup into the default 5 seconds.
  const pastDeadline = 30_000;
  // One byte every 20 ms: the body never ends, and the connection is never idle.
  const drips = () =>
    new Response(async function* () {
      for (;;) {
        yield ".";
        await Bun.sleep(20);
      }
    }, asPng);

  test(
    "images that miss the deadline are alt text, and the images that arrived are drawn",
    async () => {
      const first = Buffer.from("the first image");
      const second = Buffer.from("the second image");
      const moved = Buffer.from("the image behind a redirect");
      const inTime = Buffer.from("the image that takes a third of the deadline");
      const requested: string[] = [];
      // The host answers `ms` after the request, unless bun gives up on it first. The delay
      // is the stimulus: how far away the image is.
      const after = (req: Request, ms: number, body: Buffer) =>
        new Promise<Response>(resolve => {
          const timer = setTimeout(() => resolve(new Response(body)), ms);
          req.signal.addEventListener("abort", () => clearTimeout(timer));
        });
      await using host = Bun.serve({
        ...quietHost,
        fetch(req) {
          const path = new URL(req.url).pathname;
          requested.push(path);
          switch (path) {
            case "/first.png":
              return new Response(first);
            case "/second.gif":
              return new Response(second);
            case "/moved.webp":
              return Response.redirect(new URL("/moved-to", req.url).href);
            case "/moved-to":
              return new Response(moved);
            case "/in-time.jpg":
              return after(req, REMOTE_IMAGE_DEADLINE / 3, inTime);
            case "/late.png":
              return after(req, REMOTE_IMAGE_DEADLINE * 3, png);
            case "/missing.png":
              return new Response(png, { status: 404 });
            case "/empty.png":
              return new Response("");
            case "/redirected.png":
              return Response.redirect(new URL("/redirected-to", req.url).href);
            case "/drips.png":
              return drips();
            default:
              return silent();
          }
        },
      });
      const url = (path: string) => `http://127.0.0.1:${host.port}${path}`;
      const result = await renderOnKitty([
        ["ALT-FIRST", url("/first.png")],
        ["ALT-SILENT", url("/silent.png")],
        ["ALT-SECOND", url("/second.gif")],
        ["ALT-DRIPS", url("/drips.png")],
        ["ALT-REDIRECTED", url("/redirected.png")],
        ["ALT-MOVED", url("/moved.webp")],
        ["ALT-MISSING", url("/missing.png")],
        ["ALT-EMPTY", url("/empty.png")],
        ["ALT-IN-TIME", url("/in-time.jpg")],
        ["ALT-LATE", url("/late.png")],
      ]);
      expect({ ...result, requested: requested.sort() }).toEqual({
        printed,
        altTexts: ["ALT-SILENT", "ALT-DRIPS", "ALT-REDIRECTED", "ALT-MISSING", "ALT-EMPTY", "ALT-LATE"],
        staged: { ".gif": [second], ".jpg": [inTime], ".png": [first], ".webp": [moved] },
        exitCode: 0,
        signalCode: null,
        requested: [
          "/drips.png",
          "/empty.png",
          "/first.png",
          "/in-time.jpg",
          "/late.png",
          "/missing.png",
          "/moved-to",
          "/moved.webp",
          "/redirected-to",
          "/redirected.png",
          "/second.gif",
          "/silent.png",
        ],
      });
    },
    pastDeadline,
  );

  test(
    "more stalled images than the HTTP thread runs at once cost one deadline",
    async () => {
      let requests = 0;
      await using host = Bun.serve({
        ...quietHost,
        fetch() {
          requests++;
          return silent();
        },
      });
      const images = Array.from({ length: 300 }, (_, i): [string, string] => [
        `ALT-${i}-OF-300`,
        `http://127.0.0.1:${host.port}/${i}.png`,
      ]);
      const result = await renderOnKitty(images);
      expect({ ...result, requests }).toEqual({
        printed,
        altTexts: images.map(([alt]) => alt),
        staged: {},
        exitCode: 0,
        signalCode: null,
        // The HTTP thread runs 256 requests at a time. The other 44 wait for a free slot,
        // and are aborted there: they never reach the host.
        requests: 256,
      });
    },
    pastDeadline,
  );

  // Ctrl-S stops the output of a POSIX terminal. The document is more than a stopped
  // terminal takes into its queue, so bun blocks when it prints and cannot exit. The
  // requests must end at the deadline all the same, not when bun exits.
  test.skipIf(!isPosix)(
    "the requests that miss the deadline are aborted",
    async () => {
      const stalled = ["/silent-1.png", "/silent-2.png", "/drips.png"];
      let ended = 0;
      const allEnded = Promise.withResolvers<void>();
      await using host = Bun.serve({
        ...quietHost,
        fetch(req) {
          req.signal.addEventListener("abort", () => {
            if (++ended === stalled.length) allEnded.resolve();
          });
          return new URL(req.url).pathname === "/drips.png" ? drips() : silent();
        },
      });
      let exitedBeforeTheRequestsEnded: boolean | undefined;
      const result = await renderOnKitty(
        stalled.map((path, i): [string, string] => [`ALT-${i}`, `http://127.0.0.1:${host.port}${path}`]),
        {
          text: Buffer.alloc(64 * 1024, "text that the stopped terminal does not take ").toString(),
          async meanwhile(terminal, proc) {
            terminal.write("\x13");
            await allEnded.promise;
            exitedBeforeTheRequestsEnded = proc.exitCode !== null || proc.signalCode !== null;
            terminal.write("\x11");
          },
        },
      );
      expect({ ...result, exitedBeforeTheRequestsEnded }).toEqual({
        printed,
        altTexts: ["ALT-0", "ALT-1", "ALT-2"],
        staged: {},
        exitCode: 0,
        signalCode: null,
        exitedBeforeTheRequestsEnded: false,
      });
    },
    pastDeadline,
  );

  // On Linux the HTTP thread reads $SSL_CERT_FILE when it first needs TLS. A FIFO that
  // nobody writes to blocks that thread in open(2), so no request ever reports or aborts.
  test.skipIf(!isLinux)(
    "an HTTP thread that is stuck costs one deadline",
    async () => {
      using dir = tempDir("md-remote-img-ca-", {});
      const fifo = join(String(dir), "ca.pem");
      mkfifo(fifo);
      await using host = Bun.serve({ ...quietHost, fetch: () => new Response(png, asPng) });
      const result = await renderOnKitty(
        [
          ["ALT-HTTPS", `https://127.0.0.1:${host.port}/a.png`],
          ["ALT-HTTP", `http://127.0.0.1:${host.port}/b.png`],
        ],
        { env: { SSL_CERT_FILE: fifo } },
      );
      expect(result).toEqual({
        printed,
        altTexts: ["ALT-HTTPS", "ALT-HTTP"],
        staged: {},
        exitCode: 0,
        signalCode: null,
      });
    },
    pastDeadline,
  );

  test("a compressed body is not staged, and bun asks for none", async () => {
    const acceptEncoding: (string | null)[] = [];
    await using host = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        acceptEncoding.push(req.headers.get("accept-encoding"));
        switch (new URL(req.url).pathname) {
          case "/gzip.png":
            return new Response(Bun.gzipSync(png), { headers: { "content-encoding": "gzip" } });
          case "/identity.png":
            return new Response(png, { headers: { "content-encoding": "identity" } });
          default:
            // Not a coding bun decodes: the body is the image as it is.
            return new Response(png, { headers: { "content-encoding": "aws-chunked" } });
        }
      },
    });
    const url = (path: string) => `http://127.0.0.1:${host.port}${path}`;
    const result = await renderOnKitty([
      ["ALT-GZIP", url("/gzip.png")],
      ["ALT-IDENTITY", url("/identity.png")],
      ["ALT-UNKNOWN-CODING", url("/unknown-coding.gif")],
    ]);
    expect({ ...result, acceptEncoding }).toEqual({
      printed,
      altTexts: ["ALT-GZIP"],
      staged: { ".gif": [png], ".png": [png] },
      exitCode: 0,
      signalCode: null,
      acceptEncoding: ["identity", "identity", "identity"],
    });
  });

  // The next two move 64 MiB each way, twice. Each runs alone, so that on a loaded machine
  // the bodies still arrive well inside bun's deadline.
  test.serial(
    "a body that does not end is cut off at the byte budget, and the image that arrived is kept",
    async () => {
      const chunk = Buffer.alloc(1024 * 1024, "x");
      let sent = 0;
      await using host = Bun.serve({
        ...quietHost,
        fetch(req) {
          if (new URL(req.url).pathname === "/arrives.png") return new Response(png, asPng);
          return new Response(
            new ReadableStream({
              // Twice the budget, then the body stays open: a bun that has no budget takes all of it.
              pull(controller) {
                if (sent >= 2 * REMOTE_IMAGE_BYTE_BUDGET) return new Promise<void>(() => {});
                sent += chunk.length;
                controller.enqueue(chunk);
              },
            }),
            asPng,
          );
        },
      });
      const url = (path: string) => `http://127.0.0.1:${host.port}${path}`;
      const result = await renderOnKitty([
        ["ALT-ARRIVES", url("/arrives.png")],
        ["ALT-ENDLESS", url("/endless.gif")],
      ]);
      expect({ ...result, staged: lengths(result.staged), arrived: result.staged[".png"] }).toEqual({
        printed,
        altTexts: ["ALT-ENDLESS"],
        staged: { ".png": [png.length] },
        arrived: [png],
        exitCode: 0,
        signalCode: null,
      });
      // The budget ended the body, not the deadline: the host got rid of the budget, and of
      // no more than what the sockets held when bun stopped reading.
      expect(sent).toBeGreaterThanOrEqual(REMOTE_IMAGE_BYTE_BUDGET);
      expect(sent).toBeLessThan(1.5 * REMOTE_IMAGE_BYTE_BUDGET);
    },
  );

  test.serial(
    "the byte budget is for the whole document: the body that takes it one byte past is dropped",
    async () => {
      const big = Buffer.alloc(REMOTE_IMAGE_BYTE_BUDGET, "remote image bytes ");
      // With the png, `rest` is exactly the budget and `restAndOne` is one byte past it.
      const rest = big.subarray(0, REMOTE_IMAGE_BYTE_BUDGET - png.length);
      const restAndOne = big.subarray(0, REMOTE_IMAGE_BYTE_BUDGET - png.length + 1);
      // The body that goes past the budget starts after the host answered the png of the
      // same document, so the png is the image that arrived first.
      const pngAnswered = Promise.withResolvers<void>();
      await using host = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
          switch (new URL(req.url).pathname) {
            case "/small.png":
              return new Response(png, asPng);
            case "/small-first.png":
              pngAnswered.resolve();
              return new Response(png, asPng);
            case "/rest.gif":
              return new Response(rest, asPng);
            default:
              await pngAnswered.promise;
              return new Response(restAndOne, asPng);
          }
        },
      });
      const url = (path: string) => `http://127.0.0.1:${host.port}${path}`;
      const atBudget = await renderOnKitty([
        ["ALT-SMALL", url("/small.png")],
        ["ALT-REST", url("/rest.gif")],
      ]);
      const pastBudget = await renderOnKitty([
        ["ALT-REST-AND-ONE", url("/rest-and-one.gif")],
        ["ALT-SMALL", url("/small-first.png")],
      ]);
      expect({
        ...atBudget,
        staged: lengths(atBudget.staged),
        restIsStagedByteForByte: atBudget.staged[".gif"]?.[0]?.equals(rest),
      }).toEqual({
        printed,
        altTexts: [],
        staged: { ".gif": [rest.length], ".png": [png.length] },
        restIsStagedByteForByte: true,
        exitCode: 0,
        signalCode: null,
      });
      // Each of the two bodies is under the budget on its own.
      expect({ ...pastBudget, staged: lengths(pastBudget.staged) }).toEqual({
        printed,
        altTexts: ["ALT-REST-AND-ONE"],
        staged: { ".png": [png.length] },
        exitCode: 0,
        signalCode: null,
      });
    },
  );
});

/** The lengths of the staged files, for a failure message that does not print 64 MiB. */
function lengths(staged: Record<string, Buffer[]>) {
  return Object.fromEntries(Object.entries(staged).map(([extension, files]) => [extension, files.map(f => f.length)]));
}
