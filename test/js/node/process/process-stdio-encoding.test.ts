import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExeAtLeast, tempDir } from "harness";
import path from "path";

// A FileSink writes a string as UTF-8, so process.stdout/stderr decode every other encoding before the sink. Each row
// is statements run with `w` as the stream, then what Node.js does with them: the bytes on the fd in hex, or the code
// thrown. The "in node" tests run the same rows in Node.js, so they check the table itself.
const stdioWriteRuntimes = [
  ["bun", bunExe()],
  ["node", nodeExeAtLeast("26.3.0")],
] as const;
describe.concurrent.each(["stdout", "stderr"] as const)("process.%s.write(chunk, encoding)", name => {
  const rows: [statements: string, expected: string][] = [
    [`w.write("0001ff", "hex")`, "0001ff"],
    [`w.write("0001ff", "HEX")`, "0001ff"],
    [`w.write("AAEC/w==", "base64")`, "000102ff"],
    [`w.write("AAEC_w", "base64url")`, "000102ff"],
    [`w.write("\\u00e9\\u00ff", "latin1")`, "e9ff"],
    [`w.write("\\u00e9\\u00ff", "binary")`, "e9ff"],
    [`w.write("a\\u00e9", "ascii")`, "61e9"],
    [`w.write("ab", "utf16le")`, "61006200"],
    [`w.write("ab", "utf-16le")`, "61006200"],
    [`w.write("ab", "ucs2")`, "61006200"],
    [`w.write("ab", "ucs-2")`, "61006200"],
    [`w.write("\\u00e9", "utf8")`, "c3a9"],
    [`w.write("\\u00e9", "utf-8")`, "c3a9"],
    [`w.write("\\u00e9", "UTF8")`, "c3a9"],
    [`w.write("\\u00e9")`, "c3a9"],
    [`w.write("\\u00e9", "")`, "c3a9"],
    [`w.write("\\u00e9", null, () => {})`, "c3a9"],
    [`w.write("\\u00e9", () => {})`, "c3a9"],
    [`w.write("0001ff", "hex", () => {})`, "0001ff"],
    [`w.write("", "hex")`, ""],
    [`w.write("zz", "hex")`, ""],
    [`w.write(Buffer.from("x"), "hex")`, "78"],
    [`w.write(Buffer.from("x"), "buffer")`, "78"],
    [`w.write(new Uint8Array([120]), "hex")`, "78"],
    [`w.write("00", "hex"); w.write("A"); w.write("AQ==", "base64"); w.write("B")`, "00410142"],

    [`w.setDefaultEncoding("hex"); w.write("0001ff")`, "0001ff"],
    [`w.setDefaultEncoding("HEX"); w.write("0001ff")`, "0001ff"],
    [`w.setDefaultEncoding("hex"); w.write("0001ff", () => {})`, "0001ff"],
    [`w.setDefaultEncoding("hex"); w.write("\\u00e9", "utf8")`, "c3a9"],
    [`w.setDefaultEncoding("hex"); w.write(Buffer.from("x"))`, "78"],
    [`w.setDefaultEncoding("hex"); w.write("00"); w.setDefaultEncoding("utf8"); w.write("00")`, "003030"],
    [`w._writableState.defaultEncoding = "hex"; w.write("0001ff")`, "0001ff"],
    [`w.setDefaultEncoding("hex"); new (require("node:console").Console)(w).log("ff")`, "ff"],

    [`w.write.bind(w)("0001ff", "hex")`, "0001ff"],
    [
      `const write = w.write; w.write = function (chunk, encoding, cb) { return write.call(this, chunk, encoding, cb); }; w.write("0001ff", "hex"); w.write = write`,
      "0001ff",
    ],
    [`w.cork(); w.write("0001ff", "hex"); w.uncork()`, "0001ff"],

    [`w.write("x", "nope", cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write("x", "buffer", cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write(Buffer.from("x"), "nope", cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write(new Uint8Array([120]), "nope", cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write("x", 123, cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write("x", {}, cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write("x", true, cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write("", "nope", cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write(123, "nope", cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write(undefined, "nope", cb)`, "ERR_UNKNOWN_ENCODING"],
    [`w.write(null, "nope", cb)`, "ERR_STREAM_NULL_VALUES"],

    [`w.destroy(); w.write("0001ff", "hex")`, "0001ff"],
  ];

  // A ";" follows each row: no row can write that byte. The child reports the codes thrown, and how often `cb` ran, on
  // the other stream.
  const script = `
    const w = process.${name};
    const separator = Buffer.from(";");
    const threw = {};
    let callbacks = 0;
    const cb = () => callbacks++;
    process.on("exit", () => require("node:fs").writeSync(${name === "stdout" ? 2 : 1}, JSON.stringify({ threw, callbacks })));
    ${rows
      .map(
        ([statements], i) =>
          `try { ${statements}; } catch (e) { threw[${i}] = e?.code ?? "no code: " + e; } w.setDefaultEncoding("utf8"); w.write(separator);`,
      )
      .join("\n    ")}
    w.write("41", "hex"); w.write("42", "hex"); w.write("c"); process.exit(0);
  `;

  describe.each(stdioWriteRuntimes)("in %s", (_runtime, exe) => {
    test.skipIf(!exe).each(["pipe", "file"] as const)("to a %s", async target => {
      using dir = tempDir(`process-${name}-write-encoding`, {});
      const file = path.join(String(dir), "out");
      const stdio = (stream: "stdout" | "stderr") => (stream === name && target === "file" ? Bun.file(file) : "pipe");
      await using proc = spawn({
        cmd: [exe!, "-e", script],
        env: bunEnv,
        stdout: stdio("stdout"),
        stderr: stdio("stderr"),
      });
      const piped = (stream: "stdout" | "stderr") =>
        stream === name && target === "file" ? undefined : (proc[stream] as ReadableStream<Uint8Array>).bytes();
      const [stdout, stderr, exitCode] = await Promise.all([piped("stdout"), piped("stderr"), proc.exited]);
      const [mine, other] = name === "stdout" ? [stdout, stderr] : [stderr, stdout];
      const written = Buffer.from(target === "file" ? await Bun.file(file).bytes() : mine!);

      const reported = Buffer.from(other!).toString();
      let report: { threw: Record<number, string>; callbacks: number };
      try {
        report = JSON.parse(reported);
      } catch {
        throw new Error(`the child did not report on the other stream: ${JSON.stringify(reported)}`);
      }
      // latin1 maps each byte to one char and back, so this splits the bytes at each separator.
      const segments = written
        .toString("latin1")
        .split(";")
        .map(segment => Buffer.from(segment, "latin1").toString("hex"));
      const actual = rows.map(([statements], i) => [
        statements,
        i in report.threw ? [report.threw[i], segments[i]].filter(Boolean).join(" after writing ") : segments[i],
      ]);

      expect({
        rows: Object.fromEntries(actual),
        beforeExit: segments.slice(rows.length),
        callbacks: report.callbacks,
        exitCode,
      }).toEqual({
        rows: Object.fromEntries(rows),
        // "41" and "42" as hex, then "c": the decoded chunks leave in call order, and process.exit() does not drop them.
        beforeExit: ["414263"],
        callbacks: 0,
        exitCode: 0,
      });
    });
  });
});
