import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunExe, bunEnv } from "harness";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function withTmpDir(cb: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "bun-jsx-preserve-"));
  try {
    cb(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("jsx:preserve", () => {
  const source = 'console.log(<span>Hello</span>);';
  const tsconfig = '{\n  "compilerOptions": {\n    "jsx": "preserve",\n    "target": "ESNext"\n  }\n}';

  test("bun build --jsx-runtime=preserve emits raw JSX", () => {
    withTmpDir(dir => {
      const input = path.join(dir, "input.tsx");
      const tsconfigPath = path.join(dir, "tsconfig.json");
      const outfile = path.join(dir, "out.js");
      writeFileSync(input, source);
      writeFileSync(tsconfigPath, tsconfig);

      const { exitCode, stderr } = spawnSync({
        cmd: [bunExe(), "build", "--jsx-runtime=preserve", input, "--outfile", outfile],
        cwd: dir,
        env: bunEnv,
      });

      expect(exitCode).toBe(0);
      const stderrStr = String(stderr ?? "");
      expect(stderrStr).toBe("");

      const out = readFileSync(outfile, "utf8");
      expect(out).toContain("<span>");
      expect(out).not.toContain("React.createElement");
    });
  });

  test("preserve + --minify still emits JSX", () => {
    withTmpDir(dir => {
      const input = path.join(dir, "input.tsx");
      const tsconfigPath = path.join(dir, "tsconfig.json");
      const outfile = path.join(dir, "out.js");
      writeFileSync(input, source);
      writeFileSync(tsconfigPath, tsconfig);

      const { exitCode, stderr } = spawnSync({
        cmd: [bunExe(), "build", "--minify", "--jsx-runtime=preserve", input, "--outfile", outfile],
        cwd: dir,
        env: bunEnv,
      });

      expect(exitCode).toBe(0);
      const stderrStr2 = String(stderr ?? "");
      expect(stderrStr2).toBe("");

      const out = readFileSync(outfile, "utf8");
      expect(out).toContain("<span>");
    });
  });

  test("spread props are preserved", () => {
    withTmpDir(dir => {
      const input = path.join(dir, "spread.tsx");
      const tsconfigPath = path.join(dir, "tsconfig.json");
      const outfile = path.join(dir, "out-spread.js");
      writeFileSync(input, 'console.log(<Comp {...{foo:1,bar:"baz"}} />);');
      writeFileSync(tsconfigPath, tsconfig);

      const { exitCode, stderr } = spawnSync({
        cmd: [bunExe(), "build", "--jsx-runtime=preserve", input, "--outfile", outfile],
        cwd: dir,
        env: bunEnv,
      });
      expect(exitCode).toBe(0);
      const errSpread = String(stderr ?? "");
      expect(errSpread).toBe("");

      const outSpread = readFileSync(outfile, "utf8");
      expect(outSpread).toContain("<Comp {...");
      expect(outSpread).not.toContain("createElement");
    });
  });

  test("JS expressions inside preserve", () => {
    withTmpDir(dir => {
      const input = path.join(dir, "expr.tsx");
      const tsconfigPath = path.join(dir, "tsconfig.json");
      const outfile = path.join(dir, "out-expr.js");
      writeFileSync(input, 'console.log(<div>{1+2}</div>);');
      writeFileSync(tsconfigPath, tsconfig);

      const { exitCode, stderr } = spawnSync({
        cmd: [bunExe(), "build", "--jsx-runtime=preserve", input, "--outfile", outfile],
        cwd: dir,
        env: bunEnv,
      });
      expect(exitCode).toBe(0);
      const errExpr = String(stderr ?? "");
      expect(errExpr).toBe("");

      const outExpr = readFileSync(outfile, "utf8");
      expect(outExpr).toMatch(/\{\s*1\s*\+\s*2\s*}/);
      expect(outExpr).toContain("</div>");
    });
  });

  test("nested elements preserved", () => {
    withTmpDir(dir => {
      const input = path.join(dir, "nested.tsx");
      const tsconfigPath = path.join(dir, "tsconfig.json");
      const outfile = path.join(dir, "out-nested.js");
      writeFileSync(input, 'console.log(<div><span><em>Text</em></span></div>);');
      writeFileSync(tsconfigPath, tsconfig);

      const { exitCode, stderr } = spawnSync({
        cmd: [bunExe(), "build", "--jsx-runtime=preserve", input, "--outfile", outfile],
        cwd: dir,
        env: bunEnv,
      });
      expect(exitCode).toBe(0);
      const errNested = String(stderr ?? "");
      expect(errNested).toBe("");

      const outNested = readFileSync(outfile, "utf8");
      expect(outNested).toContain("<div><span><em>Text</em></span></div>");
    });
  });
});
