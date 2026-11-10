import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, tempDir } from "harness";
import { parseEnv } from "node:util";

describe("Bun.parseEnv", () => {
  const content = [
    "A=1",
    "B=$A",
    "C=${A:-x}",
    "D=\\$A",
    "E=${MISSING:-dflt}",
    "F=$B-$A",
    "S='$A'",
    "PROBE=$PROBE:/x",
    "REF=$PROBE",
    "Z=$LATE",
    "LATE=late",
    "0=zero",
  ].join("\n");
  const keys = ["A", "B", "C", "D", "E", "F", "S", "PROBE", "REF", "Z", "LATE", "0"];

  test("gives the same values as the startup loader", async () => {
    using dir = tempDir("dotenv-parse-env", {
      ".env": content,
      "index.ts": `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map(k => [k, process.env[k]]))));`,
    });
    const { stdout } = await bunRun(`${dir}/index.ts`, { PROBE: "fromproc" });
    const fromStartup = JSON.parse(stdout);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.log(JSON.stringify(Bun.parseEnv(require("fs").readFileSync(".env", "utf8"))))`],
      cwd: String(dir),
      env: { ...bunEnv, PROBE: "fromproc" },
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toBe("");
    expect(JSON.parse(out)).toEqual(fromStartup);
    expect(fromStartup).toEqual({
      "0": "zero",
      A: "1",
      B: "1",
      C: "1",
      D: "$A",
      E: "dflt",
      F: "1-1",
      S: "1",
      PROBE: "fromproc",
      REF: "fromproc",
      Z: "late",
      LATE: "late",
    });
    expect(exitCode).toBe(0);
  });

  test("expands against options.env instead of the process environment", () => {
    expect(Bun.parseEnv(content, { env: { PROBE: "custom", LATE: "from-env" } })).toEqual({
      "0": "zero",
      A: "1",
      B: "1",
      C: "1",
      D: "$A",
      E: "dflt",
      F: "1-1",
      S: "1",
      PROBE: "custom",
      REF: "custom",
      Z: "from-env",
      LATE: "from-env",
    });
    // An empty env: nothing outside the content resolves.
    expect(Bun.parseEnv("A=$PATH\nB=${PATH:-none}", { env: {} })).toEqual({ A: "", B: "none" });
    // A later process.env write is not part of the default source, but is of `env: process.env`.
    process.env.BUN_PARSE_ENV_LATER = "set-at-runtime";
    try {
      expect(Bun.parseEnv("X=$BUN_PARSE_ENV_LATER")).toEqual({ X: "" });
      expect(Bun.parseEnv("X=$BUN_PARSE_ENV_LATER", { env: process.env })).toEqual({ X: "set-at-runtime" });
    } finally {
      delete process.env.BUN_PARSE_ENV_LATER;
    }
  });

  test("options.env values are stringified and undefined is skipped", () => {
    expect(Bun.parseEnv("A=$N\nB=$U\nC=$T", { env: { N: 1, U: undefined, T: true } })).toEqual({
      A: "1",
      B: "",
      C: "true",
    });
  });

  test("expand: false matches util.parseEnv", () => {
    expect(Bun.parseEnv(content, { expand: false })).toEqual(parseEnv(content));
    expect(Bun.parseEnv(content, { expand: false }).B).toBe("$A");
  });

  test("returns a plain object with only the keys of the content", () => {
    const result = Bun.parseEnv("A=1\nB=$HOME");
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.keys(result)).toEqual(["A", "B"]);
    expect(Bun.parseEnv("A=1", null)).toEqual({ A: "1" });
    expect(Bun.parseEnv("A=1", undefined)).toEqual({ A: "1" });
    expect(Bun.parseEnv("")).toEqual({});
  });

  test("rejects bad arguments", () => {
    expect(() => Bun.parseEnv(5 as any)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", message: expect.stringContaining('"content"') }),
    );
    expect(() => Bun.parseEnv("A=1", "x" as any)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    expect(() => Bun.parseEnv("A=1", { env: 5 as any })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", message: expect.stringContaining('"options.env"') }),
    );
    expect(() => Bun.parseEnv("A=1", { env: { "A\0": "x" } })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
    expect(() => Bun.parseEnv("A=1", { env: { A: "x\0" } })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  test("util.parseEnv still does not expand", () => {
    expect(parseEnv("A=1\nB=$A")).toEqual({ A: "1", B: "$A" });
  });
});
