import { estimateShallowMemoryUsageOf, heapStats } from "bun:jsc";
import { describe, expect, jest, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const { markdown } = Bun;

function specExamples(file: string): string[] {
  const fence = "`".repeat(32);
  const lines = readFileSync(join(import.meta.dir, file), "utf8")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const examples: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(fence + " example")) continue;
    const end = lines.indexOf(".", i);
    examples.push((lines.slice(i + 1, end).join("\n") + "\n").replaceAll("→", "\t"));
    i = end;
  }
  return examples;
}

function cut<T extends string | Uint8Array>(input: T, size: number): T[] {
  const chunks: T[] = [];
  for (let i = 0; i < input.length; i += size) chunks.push(input.slice(i, i + size) as T);
  return chunks;
}

const options = { headings: true, autolinks: true, wikiLinks: true, latexMath: true };
const tag = (name: string) => (children: string, meta?: unknown) =>
  `<${name} ${JSON.stringify(meta)}>${children}</${name}>`;
const callbacks = Object.fromEntries(
  ["heading", "paragraph", "blockquote", "code", "list", "listItem", "table", "th", "td", "html", "link", "image"].map(
    name => [name, tag(name)],
  ),
);

/** `join` makes of the results of a stream what `whole` returns. */
const formats = {
  html: {
    stream: () => markdown.htmlStream(options),
    whole: (input: string) => markdown.html(input, options),
    join: (parts: string[]) => parts.join(""),
  },
  ansi: {
    stream: () => markdown.ansiStream({ columns: 20, light: false }),
    whole: (input: string) => markdown.ansi(input, { columns: 20, light: false }),
    join: (parts: string[]) => parts.join(""),
  },
  "ansi without colors": {
    stream: () => markdown.ansiStream({ colors: false }),
    whole: (input: string) => markdown.ansi(input, { colors: false }),
    join: (parts: string[]) => parts.join(""),
  },
  render: {
    stream: () => markdown.renderStream(callbacks, options),
    whole: (input: string) => markdown.render(input, callbacks, options),
    join: (parts: string[]) => parts.join(""),
  },
  react: {
    stream: () => markdown.reactStream({ p: "section" } as any, options),
    whole: (input: string) =>
      JSON.stringify((markdown.react(input, { p: "section" } as any, options).props as any).children),
    join: (parts: unknown[][]) => JSON.stringify(parts.flat()),
  },
  tokens: {
    stream: () => markdown.tokensStream(options),
    whole: (input: string) => JSON.stringify(markdown.tokens(input, options)),
    join: (parts: unknown[][]) => JSON.stringify(parts.flat()),
  },
} as const;
type Format = { stream(): Bun.markdown.MarkdownStream<any>; whole(input: string): string; join(parts: any[]): string };

function streamed(format: Format, chunks: (string | Uint8Array)[]): string {
  const stream = format.stream();
  return format.join([...chunks.map(chunk => stream.write(chunk)), stream.end()]);
}

const specFiles = ["spec.txt", "spec-gfm.txt", "spec-tables.txt", "spec-tasklists.txt", "regressions.txt"];

function expectExamplesToStream(format: Format, file: string, newline: string) {
  const examples = specExamples(file).map(input => input.replaceAll("\n", newline));
  expect(examples.length).toBeGreaterThan(0);
  expect(examples.map(input => streamed(format, cut(Buffer.from(input), 7)))).toEqual(
    // A reference does not see the definitions behind it: then what counts is that the cuts do not matter.
    examples.map(input => (input.includes("]:") ? streamed(format, [input]) : format.whole(input))),
  );
}

describe.each(["\r\n", "\r"])("lines ending in %j", newline => {
  test.each(specFiles)("%s", file => expectExamplesToStream(formats.html, file, newline));
});

describe.each(Object.entries(formats) as [string, Format][])("%s", (_, format) => {
  test.each(specFiles)("%s", file => expectExamplesToStream(format, file, "\n"));

  test("preview() is the rest of what the text so far renders as, and changes nothing", () => {
    const input = [
      "[a]: /first\n\n# Same\n\nSame\n====\n\n- [ ] one\n- [x] two\n\n  loose [a]\n\n",
      "[b]: /second\n[a] [b] *text*\n| x | y |\n|:--|--:|\n| 1 | 2 |\n\n> # Same\n> ```js\n> let x;\n\n",
      "1. ```c\n   y\n   ```\n2. <!--\n   z -->\n\n    code\n\n\n# Same\n***\n~~~ sh\nls\n~~~\nend",
    ].join("");
    const stream = format.stream();
    const finished: unknown[] = [];
    for (let i = 0; i < input.length; i++) {
      finished.push(stream.write(input[i]));
      const expected = format.whole(input.slice(0, i + 1));
      expect(format.join([...finished, stream.preview()])).toBe(expected);
      expect(format.join([...finished, stream.preview()])).toBe(expected);
    }
    expect(format.join([...finished, stream.end()])).toBe(format.whole(input));
  });

  test("pipeThrough", async () => {
    const input = "# é\n\n- a\n- b\n\n```js\nx\n```\n\nlast";
    const source = new ReadableStream({
      start(controller) {
        for (const chunk of cut(Buffer.from(input), 3)) controller.enqueue(chunk);
        controller.close();
      },
    });
    const parts = await Array.fromAsync(source.pipeThrough(format.stream()));
    expect(parts.map(part => part.length > 0)).toEqual(Array(4).fill(true));
    expect(format.join(parts)).toBe(format.whole(input));
  });

  test.each([
    ["an autolink over the end of emphasis", "*foo www.a.com/x*y bar\n\n> second `x` y\n\nthird\n"],
    ["fenced code behind a byte order mark", "\ufeff```js\nx\n```\n"],
  ])("%s", (_, input) => {
    expect([streamed(format, [input]), streamed(format, [...input])]).toEqual([
      format.whole(input),
      format.whole(input),
    ]);
  });

  test("an empty document", () => {
    const stream = format.stream();
    expect(format.join([stream.preview(), stream.write(""), stream.write(new Uint8Array()), stream.end()])).toBe(
      format.whole(""),
    );
  });

  test("after end()", () => {
    const stream = format.stream();
    stream.end("a");
    const ended = expect.objectContaining({ code: "ERR_INVALID_STATE", message: "The markdown stream has ended" });
    expect(() => stream.write("b")).toThrow(ended);
    expect(() => stream.end()).toThrow(ended);
    expect(format.join([stream.preview()])).toBe(format.whole(""));
  });
});

test.each([
  ["a heading", ["# a", "\n"], ["", "<h1>a</h1>\n", ""]],
  ["a thematic break", ["***", "\n"], ["", "<hr />\n", ""]],
  ["a paragraph", ["a\n", "b\n", "\n"], ["", "", "<p>a\nb</p>\n", ""]],
  ["a setext heading", ["a\n", "==", "\n"], ["", "", "<h1>a</h1>\n", ""]],
  ["an interrupted paragraph", ["a\n", "> b\n"], ["", "<p>a</p>\n", "<blockquote>\n<p>b</p>\n</blockquote>\n"]],
  ["fenced code", ["```\n", "\n", "# a\n", "```\n"], ["", "", "", "<pre><code>\n# a\n</code></pre>\n", ""]],
  ["indented code", ["    a\n", "\n", "b\n"], ["", "", "<pre><code>a\n</code></pre>\n", "<p>b</p>\n"]],
  ["an HTML comment", ["<!-- a\n", "b -->\n"], ["", "<!-- a\nb -->\n", ""]],
  ["one line of HTML", ["<script>a</script>\n"], ["<script>a</script>\n", ""]],
  ["HTML", ["<div>\n", "a\n", "\n"], ["", "", "<div>\na\n", ""]],
  [
    "a list that turns out to be loose",
    ["- a\n", "\n", "- b\n", "\n", "c\n"],
    ["", "", "", "", "<ul>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n</li>\n</ul>\n", "<p>c</p>\n"],
  ],
  [
    "a list that another list ends",
    ["- a\n", "* b\n", "\n", "* c\n"],
    ["", "<ul>\n<li>a</li>\n</ul>\n", "", "", "<ul>\n<li>\n<p>b</p>\n</li>\n<li>\n<p>c</p>\n</li>\n</ul>\n"],
  ],
  [
    "a paragraph that a table interrupts",
    ["a\n", "|b|\n", "|-|\n", "|c|\n"],
    [
      "",
      "",
      "<p>a</p>\n",
      "",
      "<table>\n<thead>\n<tr><th>b</th></tr>\n</thead>\n<tbody>\n<tr><td>c</td></tr>\n</tbody>\n</table>\n",
    ],
  ],
  ["\\r\\n", ["# a\r", "\n", "b"], ["", "<h1>a</h1>\n", "", "<p>b</p>\n"]],
  ["\\r", ["# a\r", "b"], ["", "<h1>a</h1>\n", "<p>b</p>\n"]],
  ["several blocks", ["# a\n# b\nc"], ["<h1>a</h1>\n<h1>b</h1>\n", "<p>c</p>\n"]],
])("%s is returned by the write() that finishes it", (_, chunks, expected) => {
  const stream = markdown.htmlStream();
  expect([...chunks.map(chunk => stream.write(chunk)), stream.end()]).toEqual(expected);
});

describe("reference definitions", () => {
  test("only those in the same block or before it are seen", () => {
    const input = "[a]\n\n> [a]\n>\n> [a]: /x\n\n[a]\n";
    const link = '<p><a href="/x">a</a></p>\n';
    const expected = `<p>[a]</p>\n<blockquote>\n${link}</blockquote>\n${link}`;
    const byCharacter = markdown.htmlStream();
    expect([...input].map(c => byCharacter.write(c)).join("") + byCharacter.end()).toBe(expected);
    expect(markdown.htmlStream().end(input)).toBe(expected);
  });

  test("the examples of the spec, once their definitions have been seen", () => {
    const examples = specExamples("spec.txt").filter(input => input.includes("]:"));
    expect(examples.length).toBeGreaterThan(50);
    expect(
      examples.map(input => {
        const stream = markdown.htmlStream();
        stream.write(input + "\n***\n");
        return cut(input, 3).reduce((html, chunk) => html + stream.write(chunk), "") + stream.end();
      }),
    ).toEqual(examples.map(input => markdown.html(input)));
  });

  test("what references may expand to grows with the document", () => {
    const input = `[a]: /${Buffer.alloc(2000, "x")}\n\n${Buffer.alloc(2080, "[a] ")}`;
    const stream = markdown.htmlStream();
    stream.write(input);
    const expected = markdown.html(input);
    expect(expected.length).toBeLessThan(input.length * 20);
    expect([stream.preview() === expected, stream.end() === expected]).toEqual([true, true]);
  });

  test("one that a preview has seen is forgotten", () => {
    const stream = markdown.htmlStream();
    stream.write("[a]: /x");
    expect(stream.preview()).toBe("");
    expect(stream.end("yz\n\n[a]")).toBe('<p><a href="/xyz">a</a></p>\n');
  });

  test("a preview does not use up what references may expand to", () => {
    const stream = markdown.htmlStream();
    const url = "/" + Buffer.alloc(300_000, "x").toString();
    stream.write(`[a]: ${url}\n\n[a]`);
    const expected = `<p><a href="${url}">a</a></p>\n`;
    for (let i = 0; i < 4; i++) expect(stream.preview() === expected).toBe(true);
    expect(stream.write("\n\n") === expected).toBe(true);
    // The writes do.
    expect([1, 2, 3].map(() => stream.write("[a]\n\n") === expected)).toEqual([true, true, false]);
  });
});

describe("encodings", () => {
  test("a surrogate pair in two chunks", () => {
    const stream = markdown.htmlStream();
    stream.write("a\ud83d");
    expect(stream.preview()).toBe("<p>a</p>\n");
    stream.write("");
    stream.write("\ude00\ud83d");
    stream.write("\ude01");
    expect(stream.end()).toBe("<p>a😀😁</p>\n");
  });

  test.each([
    [["\ud83d"]],
    [["\ud83d", "a"]],
    [["\ud83d", "é"]],
    [["\ud83d", "漢"]],
    [["\ud83d", "\ud83d", "\ude00"]],
    [["\ud83d", "\ude00\ude00"]],
    [["\ude00"]],
  ])("an unpaired surrogate: %j", chunks => {
    const stream = markdown.htmlStream();
    for (const chunk of chunks) stream.write(chunk);
    expect(stream.end()).toBe(markdown.html(chunks.join("")));
  });

  test("an unpaired surrogate before bytes", () => {
    const stream = markdown.htmlStream();
    stream.write("\ud83d");
    expect(stream.end(Buffer.from("a"))).toBe("<p>�a</p>\n");
  });

  test("a preview leaves out a character of which bytes are missing", () => {
    const stream = markdown.htmlStream();
    expect(
      [...Buffer.from("aé😀")].map(byte => {
        stream.write(new Uint8Array([byte]));
        return stream.preview().slice(3, -5);
      }),
    ).toEqual(["a", "a", "aé", "aé", "aé", "aé", "aé😀"]);
  });

  test("end() does not", () => {
    const input = Buffer.from("a😀").subarray(0, 3);
    expect(markdown.htmlStream().end(input)).toBe(markdown.html(input));
  });

  test("only the first byte order mark is skipped", () => {
    const input = Buffer.from("﻿# a\n﻿# b\n");
    const stream = markdown.htmlStream();
    const previews: string[] = [];
    let html = "";
    for (const chunk of cut(input, 1)) {
      html += stream.write(chunk);
      previews.push(stream.preview());
    }
    expect(previews.slice(0, 4)).toEqual(["", "", "", "<h1></h1>\n"]);
    expect(html + stream.end()).toBe("<h1>a</h1>\n<p>﻿# b</p>\n");
  });

  test("every kind of buffer", () => {
    const bytes = new TextEncoder().encode("ab");
    const shared = new SharedArrayBuffer(2);
    new Uint8Array(shared).set(bytes);
    const stream = markdown.htmlStream();
    for (const chunk of [bytes, bytes.buffer, new DataView(bytes.buffer, 1), new Uint16Array(bytes.buffer), shared]) {
      stream.write(chunk);
    }
    bytes.fill(0);
    expect(stream.end()).toBe("<p>ababbabab</p>\n");
  });
});

describe("errors", () => {
  test.each([[undefined], [null], [1], [{}]])("write(%p) throws, and the stream goes on", chunk => {
    const stream = markdown.htmlStream();
    stream.write("a");
    expect(() => stream.write(chunk as any)).toThrow("Expected a string or buffer to render");
    expect(stream.end(null)).toBe("<p>a</p>\n");
  });

  test.each(["write", "end"] as const)("a callback that throws in %s() ends the stream", method => {
    const error = new Error("from the callback");
    const stream = markdown.renderStream({
      heading() {
        throw error;
      },
    });
    expect(() => stream[method]("a\n# b\n")).toThrow(error);
    expect(() => stream.write("c")).toThrow("The markdown stream has ended");
  });

  test("a callback that throws in preview() does not", () => {
    let shouldThrow = true;
    const stream = markdown.renderStream(
      {
        heading: (children, { id }) => `${id}:${children};`,
        strong(children) {
          if (shouldThrow) throw new Error("from the callback");
          return children;
        },
      },
      { headings: true },
    );
    stream.write("> # a\n> [x]: /x\n> # a **b**");
    expect(() => stream.preview()).toThrow("from the callback");
    shouldThrow = false;
    expect(stream.end("\n\nc")).toBe("a:a;a-b:a b;c");
  });

  test.each(["write", "preview", "end"] as const)("%s() in a callback of the stream throws", method => {
    const errors: string[] = [];
    const stream = markdown.renderStream({
      paragraph(children) {
        try {
          stream[method]("x");
        } catch (error: any) {
          errors.push(`${error.code}: ${error.message}`);
        }
        return children;
      },
    });
    expect([stream.write("a\n\nb"), stream.preview(), stream.end()]).toEqual(["a", "b", "b"]);
    expect(errors).toEqual(Array(3).fill("ERR_INVALID_STATE: A markdown stream cannot be used by its own callbacks"));
  });

  test("an error in the transform reaches both sides", async () => {
    const stream = markdown.htmlStream();
    const results = await Promise.allSettled([
      stream.writable.getWriter().write(1 as any),
      stream.readable.getReader().read(),
    ]);
    expect(results.map(result => (result as PromiseRejectedResult).reason?.message)).toEqual([
      "Expected a string or buffer to render",
      "Expected a string or buffer to render",
    ]);
  });

  test("an error at the end of the transform reaches the reader", async () => {
    const error = new Error("from the callback");
    const stream = markdown.renderStream({
      paragraph() {
        throw error;
      },
    });
    await expect(Array.fromAsync(new Blob(["a"]).stream().pipeThrough(stream))).rejects.toBe(error);
  });
});

test("callbacks are read once, and run once for a finished block", () => {
  const paragraph = jest.fn(children => `(${children})`);
  const given: Bun.markdown.RenderCallbacks = { paragraph };
  const stream = markdown.renderStream(given);
  given.paragraph = () => "replaced";
  expect([stream.write("a\n"), stream.write("\nb\n"), stream.write("\n"), stream.end()]).toEqual([
    "",
    "(a)",
    "(b)",
    "",
  ]);
  expect(paragraph).toHaveBeenCalledTimes(2);
});

test("reactStream() takes reactVersion", () => {
  const typeOf = (options?: Bun.markdown.ReactOptions) =>
    (markdown.reactStream(undefined, options).end("a")[0] as any).$$typeof;
  expect(typeOf()).toBe(Symbol.for("react.transitional.element"));
  expect(typeOf({ reactVersion: 18 })).toBe(Symbol.for("react.element"));
});

test("readable and writable are the same objects each time", () => {
  const stream = markdown.htmlStream();
  expect(stream.readable).toBeInstanceOf(ReadableStream);
  expect(stream.writable).toBeInstanceOf(WritableStream);
  expect(stream.readable).toBe(stream.readable);
  expect(stream.writable).toBe(stream.writable);
});

test("as the body of a Response, a block arrives before the next one is written", async () => {
  const stream = markdown.htmlStream();
  const writer = stream.writable.getWriter();
  using server = Bun.serve({ port: 0, fetch: () => new Response(stream.readable as ReadableStream) });
  await writer.write("# é\n");
  const reader = (await fetch(server.url)).body!.pipeThrough(new TextDecoderStream()).getReader();
  expect(await reader.read()).toEqual({ done: false, value: "<h1>é</h1>\n" });
  await writer.write("last");
  await writer.close();
  expect(await reader.read()).toEqual({ done: false, value: "<p>last</p>\n" });
  expect((await reader.read()).done).toBe(true);
});

test("the stream keeps its callbacks, components and transform alive", async () => {
  const make = (i: number) => {
    const { readable, writable } = markdown.renderStream({ paragraph: children => `${i}${children}` });
    return { readable, writable, react: markdown.reactStream({ p: { i } } as any) };
  };
  const streams = Array.from({ length: 50 }, (_, i) => make(i));
  Bun.gc(true);
  for (const [i, { readable, writable, react }] of streams.entries()) {
    const writer = writable.getWriter();
    writer.write("a");
    writer.close();
    expect(await Array.fromAsync(readable)).toEqual([`${i}a`]);
    expect<unknown>(react.end("a")[0].type).toEqual({ i });
  }
});

test("streams that are dropped are collected", async () => {
  for (let i = 0; i < 500; i++) {
    const stream = markdown.renderStream({ paragraph: () => stream.preview() });
    stream.write("- a\n");
    stream.readable;
  }
  // The jobs that start the transforms hold them.
  await new Promise(resolve => setImmediate(resolve));
  Bun.gc(true);
  expect(heapStats().objectTypeCounts.MarkdownStream ?? 0).toBeLessThan(50);
});

test("the text of finished blocks is released", () => {
  // Each list ends the one before it, so one is always open.
  const chunk = Buffer.alloc(8 * 1024, "- aaaaa\n* bbbbb\n").toString();
  const stream = markdown.htmlStream();
  for (let i = 0; i < 32; i++) stream.write(chunk);
  const size = estimateShallowMemoryUsageOf(stream);
  expect(size).toBeGreaterThan(chunk.length);
  expect(size).toBeLessThan(chunk.length * 4);
});

test("the room that a large chunk took is released", () => {
  const stream = markdown.htmlStream();
  stream.write(Buffer.alloc(1024 * 1024, "a\n\n".padStart(1024, "a")));
  expect(estimateShallowMemoryUsageOf(stream)).toBeLessThan(256 * 1024);
});

test("definitions and heading ids are counted", () => {
  const long = Buffer.alloc(10_000, "x").toString();
  const stream = markdown.htmlStream({ headings: true });
  for (let i = 0; i < 20; i++) stream.write(`[a${i}]: /${long}\n\n# h${i}${long}\n`);
  expect(estimateShallowMemoryUsageOf(stream)).toBeGreaterThan(40 * long.length);
});

describe("calls and pipes do not mix", () => {
  const detached = {
    code: "ERR_INVALID_STATE",
    message: "A markdown stream cannot be piped after a call to write() or end()",
  };

  test.each(["readable", "writable"] as const)("write() and end() throw while %s is locked", async side => {
    const stream = markdown.htmlStream();
    const lock = side === "readable" ? stream.readable.getReader() : stream.writable.getWriter();
    const message = "write() and end() cannot be called while the markdown stream's readable or writable is locked";
    expect(() => stream.write("a")).toThrow(message);
    expect(() => stream.end()).toThrow(message);
    lock.releaseLock();

    const writer = stream.writable.getWriter();
    await writer.write("b");
    expect(stream.preview()).toBe("<p>b</p>\n");
    writer.close();
    expect(await Array.fromAsync(stream.readable)).toEqual(["<p>b</p>\n"]);
  });

  test.each(["write", "end"] as const)("%s() errors the sides, whenever they are made", async method => {
    const before = markdown.htmlStream();
    const { readable } = before;
    before[method]("a");
    await expect(readable.getReader().read()).rejects.toMatchObject(detached);

    const after = markdown.htmlStream();
    after[method]("a");
    await expect(after.readable.getReader().read()).rejects.toMatchObject(detached);
    await expect(after.writable.getWriter().write("b")).rejects.toMatchObject(detached);
  });

  test.each(["write", "end"] as const)("%s() in a callback of preview() leaves the sides alone", async method => {
    const stream = markdown.renderStream({
      paragraph(children) {
        expect(() => stream[method]("x")).toThrow("A markdown stream cannot be used by its own callbacks");
        return children;
      },
    });
    const writer = stream.writable.getWriter();
    await writer.write("a");
    writer.releaseLock();
    expect(stream.preview()).toBe("a");
    stream.writable.close();
    expect(await Array.fromAsync(stream.readable)).toEqual(["a"]);
  });

  test("the calls go on working", () => {
    const stream = markdown.htmlStream();
    Bun.inspect(stream);
    stream.write("a");
    Bun.inspect(stream);
    expect(stream.end("b")).toBe("<p>ab</p>\n");
  });
});

test.each([
  ["readable.cancel()", (stream: Bun.markdown.MarkdownStream<string>) => stream.readable.cancel()],
  ["writable.abort()", (stream: Bun.markdown.MarkdownStream<string>) => stream.writable.abort()],
])("%s ends the stream", async (_, stop) => {
  const stream = markdown.htmlStream();
  const writer = stream.writable.getWriter();
  await writer.write("a");
  writer.releaseLock();
  expect(stream.preview()).toBe("<p>a</p>\n");
  await stop(stream);
  expect(stream.preview()).toBe("");
  expect(() => stream.end()).toThrow("The markdown stream has ended");
});

test("a callback cancels the readable", async () => {
  const stream = markdown.renderStream({
    paragraph(children) {
      stream.readable.cancel();
      Bun.gc(true);
      return children;
    },
  });
  await expect(stream.writable.getWriter().write("a\n\nb\n\nc")).rejects.toBeInstanceOf(TypeError);
  expect(stream.preview()).toBe("");
});

test("a cancelled stream lets go of its callbacks", async () => {
  const streams = Array.from({ length: 100 }, () => markdown.renderStream({ paragraph: () => "", heading: () => "" }));
  const functions = () => (Bun.gc(true), heapStats().objectTypeCounts.Function);
  const before = functions();
  await Promise.all(streams.map(stream => stream.readable.cancel()));
  expect(before - functions()).toBeGreaterThan(150);
  expect(streams).toHaveLength(100);
});

describe.each([
  {
    name: "tokensStream",
    stream: (options?: Bun.markdown.Options) => markdown.tokensStream(options),
    items: (list: any) => list.items,
    rows: (table: any) => table.rows,
    nested: (item: any) => item.tokens.at(-1),
  },
  {
    name: "reactStream",
    stream: (options?: Bun.markdown.Options) => markdown.reactStream(undefined, options),
    items: (list: any) => list.props.children,
    rows: (table: any) => table.props.children[1].props.children,
    nested: (item: any) => item.props.children.at(-1),
  },
])("$name returns what is finished in an unfinished block as the same object", ({ stream, items, rows, nested }) => {
  const same = (before: unknown[], after: unknown[]) => before.map((it, i) => it === after[i]);

  test("list items", () => {
    const md = stream();
    md.write("- a\n- b\n- c");
    const first = items(md.preview()[0]);
    md.write("c\n- d");
    const second = items(md.preview()[0]);
    expect(same(first, second)).toEqual([true, false, false]);
    Bun.gc(true);
    expect(same(second, items(md.end("\n")[0]))).toEqual([true, true, false, false]);
  });

  test("nested list items", () => {
    const md = stream();
    md.write("> 1. a\n>    - b\n>    - c\n>    - d");
    const inner = () => items(nested(items(nested(md.preview()[0]))[0]));
    expect(same(inner(), inner())).toEqual([true, false, false]);
  });

  test("table rows", () => {
    const md = stream();
    md.write("|a|\n|-|\n|1|\n|2|\n|3");
    const first = rows(md.preview()[0]);
    expect(same(first, rows(md.write("|\n\nb")[0] ?? md.preview()[0]))).toEqual([true, true, false]);
  });

  test.each([
    ["the list turns loose", "- a\n- b\n", "\n- c", undefined],
    ["a definition follows", "- [x]\n- b\n", "- [x]: /y", undefined],
    ["it has a heading with an id", "- # a\n- b\n", "- # a", { headings: true }],
  ])("not when %s", (_, start, rest, options) => {
    const md = stream(options);
    md.write(start);
    const [first] = items(md.preview()[0]);
    md.write(rest);
    expect(items(md.preview()[0])[0]).not.toBe(first);
    expect(md.preview()).toEqual(stream(options).end(start + rest));
  });

  test("not in the next block", () => {
    const md = stream();
    md.write("- a\n- b\n");
    md.preview();
    md.write("* c\n* d\n");
    expect(md.preview()).toEqual(stream().end("* c\n* d\n"));
  });
});

test.each([
  [
    ["# a\n", "\n", " ", "b"],
    [[], [], [], ["# a\n\n"], [" b"]],
  ],
  [
    ["a\n\n", "\n", "b"],
    [[], [], ["a", "\n\n\n"], ["b"]],
  ],
  [
    ["a\n", "# b\n", "c"],
    [[], ["a\n"], ["# b\n"], ["c"]],
  ],
  [
    ["\n", "\n", "a"],
    [[], [], [], ["\n\n", "a"]],
  ],
  [
    ["> a\n\n", "\n"],
    [[], [], ["> a", "\n\n\n"]],
  ],
])("a token waits for the end of the empty lines behind it: %j", (chunks, expected) => {
  const stream = markdown.tokensStream();
  expect([...chunks.map(chunk => stream.write(chunk)), stream.end()].map(it => it.map(token => token.raw))).toEqual(
    expected,
  );
});
