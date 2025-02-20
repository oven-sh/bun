import { test, expect } from "bun:test" with { todo: "true" };
import { readFileSync } from "fs";
import { bunExe, isWindows, tempDirWithFiles } from "harness";
import stripAnsi from "strip-ansi";

const REQUIRE_EXACT_ERROR_NAMES = true;

// execute in bun & node, compare output
const file_cont = readFileSync(import.meta.dirname + "/bundler_string_2.fixture.txt", "utf-8");

const header_txt = /*js*/ `
function print(msg) {
  console.log(msg);
};
`;
const header_cont = new TextEncoder().encode(header_txt);

const tmpdir = tempDirWithFiles("bundler_string_2", {});
console.log(tmpdir);

let i = 0;
for (const testdef of file_cont.split("/*=")) {
  if (!testdef.trim()) continue;
  i += 1;
  const [tname_seg, tvalue_raw, expectnone] = testdef.split("*/");
  if (tvalue_raw == null) throw new Error("bad test: tvalue missing");
  const [tname, terr_in, expectnone2] = tname_seg.split(":-:");
  let terr = terr_in;
  if (expectnone != null) throw new Error("bad test: " + tname);
  if (expectnone2 != null) throw new Error("bad test: " + tname);
  const req_eval = tname.includes("[c]");
  const req_todo = tname.includes("[todo]");
  const req_no_eval = tname.includes("[no-eval]");
  const req_no_node = tname.includes("[no-node]");

  if (terr != null && terr.trim().length < 7) terr = "[! terr.len must be > 7 !]";
  let tvalue: string | Uint8Array = tvalue_raw;
  if (req_eval) {
    tvalue = new Function("", "return " + tvalue)();
  }
  if (typeof tvalue === "string") tvalue = new TextEncoder().encode(tvalue);
  let tdecoded: string | null;
  try {
    tdecoded = new TextDecoder().decode(tvalue);
  } catch (e) {
    tdecoded = null;
  }
  if (req_no_eval) tdecoded = null;

  const tpath = "_" + i + ".js";
  await Bun.write(tmpdir + "/" + tpath, new Uint8Array([...header_cont, ...tvalue]));

  const testcb = async () => {
    // result in node
    const noderes = req_no_node
      ? null
      : Bun.spawnSync({
          cmd: ["node", tpath],
          cwd: tmpdir,
          stdin: "pipe",
          stdout: "pipe",
          stderr: terr != null ? "pipe" : "inherit",
        });
    // result in bun
    const bunres = Bun.spawnSync({
      cmd: [bunExe(), tpath],
      cwd: tmpdir,
      stdin: "pipe",
      stdout: "pipe",
      stderr: terr != null ? "pipe" : "inherit",
    });
    // result from eval()
    let evalres: string | Error = "";
    if (tdecoded != null) {
      try {
        new Function("print", tdecoded)((msg: string) => (evalres += msg + "\n"));
      } catch (e) {
        evalres = e as Error;
      }
    }

    // expects
    if (terr == null) {
      // expect ok and same result
      if (!req_no_node) expect(noderes!.exitCode).toBe(0);
      if (tdecoded != null) expect(evalres).toBeTypeOf("string");
      const nodeprinted = req_no_node ? null : noderes!.stdout.toString("utf-8").replaceAll("\r", "");
      const bunprinted = bunres.stdout.toString("utf-8").replaceAll("\r", "");
      expect({
        bunres_exitCode: bunres.exitCode,
        bunprinted: bunprinted,
      }).toEqual({
        bunres_exitCode: 0,
        bunprinted: req_no_node ? "<req_no_node>" : nodeprinted!,
      });
      if (tdecoded != null) expect(bunprinted).toBe(evalres as string);
    } else {
      // expect error
      if (!req_no_node) expect(noderes!.exitCode).not.toBe(0);
      expect(bunres.exitCode).not.toBe(0);
      if (tdecoded != null) expect(evalres).toBeInstanceOf(Error);
      const bunerrored = bunres.stderr?.toString("utf-8");
      expect(bunerrored).not.toInclude("panic");
      if (REQUIRE_EXACT_ERROR_NAMES) expect(stripAnsi(bunerrored ?? "undefined")).toInclude(terr.trim());
    }
  };
  test.todoIf(req_todo)(tname, testcb);
}

// // prettier-ignore
// test("str 1", () => expect("abc").toMatchSnapshot());
// // prettier-ignore
// test("str 2", () => expect("abc\\").toMatchSnapshot());
// // prettier-ignore
// test("str 3", () => expect("abc\"").toMatchSnapshot());
// // prettier-ignore
// test("str 4", () => expect("1234567812345678\"").toMatchSnapshot());
// // prettier-ignore
// test("str 5", () => expect("123456781234567\"1").toMatchSnapshot());
// // prettier-ignore
// test("str 6", () => expect("abc\"").toMatchSnapshot());
// // prettier-ignore
// test("str 7", () => expect("\u{0}\u{1}\u{2}\u{3}\u{4}").toMatchSnapshot());

// // tagged template literal allows bad:
// const allowed_bads = [
//   "\\u",
//   "\\u1",
//   "\\u12",
//   "\\u123",
//   "\\u1234",
//   "\\u12345",
//   "\\u{",
//   "\\u{1",
//   "\\u{12",
//   "\\u{123",
//   "\\u{1234",
//   "\\u{12345",
//   "\\u{123456",
//   "\\u{1234567",
//   "\\u{12345678",
//   "\\u{123456789",
//   "\\u{12345678910",
//   "\\u{12345678910}",
//   "\\u{12345678910}1",
//   "\\x",
//   "\\x0",
//   "\\x01",
//   "\\x012",
//   "\\x0123",
//   "\\x01234",
//   "\\01",
//   "\\012",
//   "\\0123",
//   "\\01234",
// ];
// for (const allowed_bad of allowed_bads) {
//   // each of these is allowed in a tagged template literal, but disallowed in an untagged template literal
//   "`" + allowed_bad + "`";
// }
