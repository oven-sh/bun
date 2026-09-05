import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("mock function serializer", () => {
  const fixture = /*js*/ `
    import { test, expect, mock, jest } from "bun:test";

    test("t", () => {
      const fn = mock(() => 1);
      fn();
      fn("a", { b: 2 });
      expect(fn).toMatchInlineSnapshot();

      expect(jest.fn()).toMatchInlineSnapshot();

      expect(jest.fn().mockName("myNamed")).toMatchInlineSnapshot();

      expect({ cb: jest.fn() }).toMatchInlineSnapshot();

      expect(jest.spyOn({ x: 1 }, "x")).toMatchInlineSnapshot();
      expect(jest.spyOn({ greet() {} }, "greet")).toMatchInlineSnapshot();
      function impl() { return 2; }
      expect(jest.fn(impl)).toMatchInlineSnapshot();
      expect(jest.fn().mockName("gone").mockReset()).toMatchInlineSnapshot();

      expect(fn).toMatchSnapshot();
      expect(jest.fn().mockName("myNamed")).toMatchSnapshot();
    });
  `;

  it("prints [MockFunction] with calls/results in snapshots", async () => {
    using dir = tempDir("mock-serializer", { "snap.test.ts": fixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./snap.test.ts"],
      env: { ...bunEnv, CI: "false" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const src = await Bun.file(dir + "/snap.test.ts").text();
    const snap = await Bun.file(dir + "/__snapshots__/snap.test.ts.snap").text();

    expect({ stderr, src }).not.toEqual(expect.objectContaining({ src: expect.stringContaining("[class ") }));
    expect({ stderr, src }).not.toEqual(expect.objectContaining({ src: expect.stringContaining("[Function") }));
    expect(src).not.toContain("mockedFunction");
    expect(src).not.toContain("mockConstructor");
    expect(src).not.toContain("[MockFunction greet]");
    expect(src).not.toContain("[MockFunction impl]");
    expect(src).not.toContain("[MockFunction gone]");

    expect(src).toContain("toMatchInlineSnapshot(`[MockFunction]`)");
    expect(src).toContain("toMatchInlineSnapshot(`[MockFunction myNamed]`)");
    expect(src).toContain('"cb": [MockFunction]');
    expect(src).toContain('"calls": [');
    expect(src).toContain('"results": [');
    expect(src).toContain('"type": "return"');
    expect(src).toContain('"value": 1');
    expect(src).toContain(`[MockFunction] {`);

    expect(snap).toContain("[MockFunction myNamed]");
    expect(snap).toContain('"calls": [');

    expect(exitCode).toBe(0);

    await using proc2 = Bun.spawn({
      cmd: [bunExe(), "test", "./snap.test.ts"],
      env: { ...bunEnv, CI: "false" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);
    expect({ stderr2, exitCode2 }).toEqual({ stderr2: expect.stringContaining("0 fail"), exitCode2: 0 });
    expect(await Bun.file(dir + "/snap.test.ts").text()).toBe(src);
  });

  it("accepts a jest-written .snap for a mock function", async () => {
    using dir = tempDir("mock-serializer-jest", {
      "snap.test.ts": /*js*/ `
        import { test, expect, jest } from "bun:test";
        test("t", () => {
          const fn = jest.fn(() => 1);
          fn();
          fn("a");
          expect(fn).toMatchSnapshot();
          expect(jest.fn().mockName("myNamed")).toMatchSnapshot();
        });
      `,
      "__snapshots__/snap.test.ts.snap":
        "// Jest Snapshot v1, https://goo.gl/fbAQLP\n" +
        "\n" +
        "exports[`t 1`] = `\n" +
        "[MockFunction] {\n" +
        '  "calls": [\n' +
        "    [],\n" +
        "    [\n" +
        '      "a",\n' +
        "    ],\n" +
        "  ],\n" +
        '  "results": [\n' +
        "    {\n" +
        '      "type": "return",\n' +
        '      "value": 1,\n' +
        "    },\n" +
        "    {\n" +
        '      "type": "return",\n' +
        '      "value": 1,\n' +
        "    },\n" +
        "  ],\n" +
        "}\n" +
        "`;\n" +
        "\n" +
        "exports[`t 2`] = `[MockFunction myNamed]`;\n",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./snap.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({
      stderr: expect.not.stringContaining("toMatchSnapshot"),
      exitCode: 0,
    });
    expect(stderr).toContain("1 pass");
  });
});
