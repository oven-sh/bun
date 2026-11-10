import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isWindows, tempDir } from "harness";
import { parseEnv } from "node:util";

describe("Bun.parseEnv", () => {
  // PROBE comes from the process environment. Every other name is defined in the text or missing.
  const content = [
    "A=1",
    "B=$A",
    "C=${A:-x}",
    "D=\\$A",
    "E=${MISSING:-dflt}",
    "F=$B-$A",
    "S='$A'",
    "REF=$PROBE",
    "BR=${PROBE}",
    "BD=${PROBE:-x}",
    "N=${NOPE:-${PROBE}}",
    "N2=${NOPE:-${ALSO_NOPE:-$PROBE}}",
    "Z=$LATE", // a key defined later in the text still resolves
    "LATE=late",
    "0=zero",
  ].join("\n");
  const keys = ["A", "B", "C", "D", "E", "F", "S", "REF", "BR", "BD", "N", "N2", "Z", "LATE", "0"];
  const expected = (probe: string) => ({
    "0": "zero",
    A: "1",
    B: "1",
    C: "1",
    D: "$A",
    E: "dflt",
    F: "1-1",
    S: "1",
    REF: probe,
    BR: probe,
    BD: probe,
    N: probe,
    N2: probe,
    Z: "late",
    LATE: "late",
  });

  test.concurrent("gives the same values as the startup loader", async () => {
    using dir = tempDir("dotenv-parse-env", {
      ".env": content,
      "index.ts": `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map(k => [k, process.env[k]]))));`,
    });
    const { stdout, stderr, exitCode } = await bunRun(`${dir}/index.ts`, { PROBE: "fromproc" });
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const fromStartup = JSON.parse(stdout);
    expect(fromStartup).toEqual(expected("fromproc"));

    // Parse the same file from a directory without a `.env`, so no key of the text is in the
    // environment Bun loaded at startup and every value comes from the expansion pass.
    using other = tempDir("dotenv-parse-env-runtime", {});
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `console.log(JSON.stringify(Bun.parseEnv(require("fs").readFileSync(process.argv[1], "utf8"))))`,
        `${dir}/.env`,
      ],
      cwd: String(other),
      env: { ...bunEnv, PROBE: "fromproc" },
      stderr: "pipe",
    });
    const [out, err, runtimeExitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toBe("");
    expect(JSON.parse(out)).toEqual(fromStartup);
    expect(runtimeExitCode).toBe(0);
  });

  test.concurrent("the default env is the process environment without the .env files Bun loaded", async () => {
    using dir = tempDir("dotenv-parse-env-default", {
      ".env": "DB_HOST=localhost\nFROM_DOTENV=yes",
      "index.ts": `
        const text = "DB_HOST=prod\\nDB_URL=postgres://$DB_HOST/db\\nX=$FROM_DOTENV\\nP=$PROBE";
        console.log(JSON.stringify([Bun.parseEnv(text), Bun.parseEnv(text, { env: process.env })]));
      `,
    });
    const { stdout, stderr, exitCode } = await bunRun(`${dir}/index.ts`, { PROBE: "fromproc" });
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual([
      // A key of the text wins over the `.env` that Bun loaded, as it does when the text is the
      // first file the startup loader reads.
      { DB_HOST: "prod", DB_URL: "postgres://prod/db", X: "", P: "fromproc" },
      { DB_HOST: "prod", DB_URL: "postgres://localhost/db", X: "yes", P: "fromproc" },
    ]);
  });

  test.concurrent("the default env is the same in a Worker and after a proxy variable is deleted", async () => {
    using dir = tempDir("dotenv-parse-env-worker", {
      ".env": "FROM_DOTENV=yes\nLAST_DOTENV=last",
      "index.ts": `
        const text = "X=$FROM_DOTENV\\nY=$LAST_DOTENV\\nP=$PROBE";
        const main = Bun.parseEnv(text);
        // \`delete\` of a proxy variable removes an entry from the native map. The entries of the
        // .env files must not move into the process environment.
        delete process.env.HTTP_PROXY;
        const afterDelete = Bun.parseEnv(text);
        const worker = new Worker(new URL("./worker.ts", import.meta.url));
        worker.onmessage = ({ data }) => {
          console.log(JSON.stringify({ main, afterDelete, worker: data }));
          worker.terminate();
        };
      `,
      "worker.ts": `postMessage(Bun.parseEnv("X=$FROM_DOTENV\\nY=$LAST_DOTENV\\nP=$PROBE"));`,
    });
    const { stdout, stderr, exitCode } = await bunRun(`${dir}/index.ts`, {
      PROBE: "fromproc",
      HTTP_PROXY: "http://proxy",
    });
    // The worker's loader reads the `.env` files again and names them.
    expect(stderr.replace(/^\[[\d.]+ms\] "\.env"\n?$/, "")).toBe("");
    expect(exitCode).toBe(0);
    const expected = { X: "", Y: "", P: "fromproc" };
    expect(JSON.parse(stdout)).toEqual({ main: expected, afterDelete: expected, worker: expected });
  });

  test.concurrent("returns the text's value for a key the environment already has", async () => {
    // The startup loader keeps the environment's value for such a key. The parser returns the
    // text's value, expanded against the environment, and leaves the precedence to the caller.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.log(JSON.stringify(Bun.parseEnv("PROBE=$PROBE:/x\\nREF=$PROBE\\nOTHER=plain")))`],
      env: { ...bunEnv, PROBE: "fromproc", OTHER: "fromproc" },
      stderr: "pipe",
    });
    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(err).toBe("");
    expect(JSON.parse(out)).toEqual({ PROBE: "fromproc:/x", REF: "fromproc", OTHER: "plain" });
    expect(exitCode).toBe(0);
  });

  test("expands against options.env instead of the startup environment", () => {
    expect(Bun.parseEnv(content, { env: { PROBE: "custom", LATE: "from-env" } })).toEqual({
      ...expected("custom"),
      Z: "from-env",
    });
    // An empty env: nothing outside the text resolves.
    expect(Bun.parseEnv("A=$PATH\nB=${PATH:-none}", { env: {} })).toEqual({ A: "", B: "none" });
    // `env: process.env` includes a later write to process.env.
    process.env.BUN_PARSE_ENV_LATER = "set-at-runtime";
    try {
      expect(Bun.parseEnv("X=$BUN_PARSE_ENV_LATER", { env: process.env })).toEqual({ X: "set-at-runtime" });
    } finally {
      delete process.env.BUN_PARSE_ENV_LATER;
    }
  });

  test("values from options.env are used as they are", () => {
    expect(Bun.parseEnv("C=$A\nD=${A}\nE=${NOPE:-$A}\nA=lit", { env: { A: "$B", B: "x" } })).toEqual({
      C: "$B",
      D: "$B",
      E: "$B",
      A: "lit",
    });
    // The output of one parse is a valid env for the next.
    const first = Bun.parseEnv("D=\\$A");
    expect(Bun.parseEnv("X=$D", { env: first })).toEqual({ X: "$A" });
  });

  test("an empty name in options.env is skipped", () => {
    expect(Bun.parseEnv("A=${}", { env: { "": "v" } })).toEqual({ A: "" });
  });

  test("throws once the text substitutes in more than 4 MiB", () => {
    // Each line substitutes the previous value ten times, so A(n) is 10^(n+1) bytes.
    const lines = ["A0=xxxxxxxxxx"];
    for (let i = 1; i <= 7; i++) lines.push(`A${i}=` + `$A${i - 1}`.repeat(10));
    expect(Bun.parseEnv(lines.slice(0, 6).join("\n")).A5).toHaveLength(1_000_000);
    expect(() => Bun.parseEnv(lines.join("\n"))).toThrow(
      expect.objectContaining({
        name: "RangeError",
        message: 'The content expands to more than 4.19 MB of variable references at "A6"',
      }),
    );
  });

  test("options.env values are stringified and undefined is skipped", () => {
    expect(Bun.parseEnv("A=$N\nB=$U\nC=$T", { env: { N: 1, U: undefined, T: true } })).toEqual({
      A: "1",
      B: "",
      C: "true",
    });
  });

  test("options.env keys are case-insensitive on Windows only", () => {
    expect(Bun.parseEnv("X=$path", { env: { PATH: "p" } })).toEqual({ X: isWindows ? "p" : "" });
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
