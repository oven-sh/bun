import path from "path";
import { describe, test, expect } from "bun:test";
import { bunExe } from "../../../harness";

const modes = [
  //
  { label: "base" },
  { label: "minify-all", args: ["--minify"] },
  { label: "minify-syntax", args: ["--minify-syntax"] },
  { label: "minify-whitespace", args: ["--minify-whitespace"] },
  { label: "sourcemaps", args: ["--minify", "--sourcemap=external"] },
];
const nodeEnvs = ["development", "production"];
const combinations = nodeEnvs.flatMap(nodeEnv => modes.map(mode => ({ options: mode, nodeEnv })));

describe("bundler integration, react client", () => {
  for (const {
    options: { label, args },
    nodeEnv,
  } of combinations) {
    test(label + ", NODE_ENV=" + nodeEnv, async () => {
      const out = path.join(import.meta.dir, "dist/client/" + label + "-" + nodeEnv);
      const cmd = [
        bunExe(),
        "build",
        ...(args ?? []),
        "--outdir=" + out,
        "--splitting",
        path.join(import.meta.dir, "index.jsx"),
      ];
      console.log(cmd.join(" "));
      const x = Bun.spawnSync(cmd, {
        cwd: import.meta.dir,
        env: nodeEnv ? { NODE_ENV: nodeEnv } : undefined,
      });
      if (x.exitCode !== 0) {
        console.error(x.stderr.toString());
        throw new Error("Failed to build");
      }
      const proc = Bun.spawnSync(["node", path.join(import.meta.dir, "puppeteer.mjs"), out], {
        cwd: path.join(import.meta.dir),
      });
      if (!proc.success) {
        console.error(proc.stderr.toString());
        console.error(proc.stdout.toString());
        expect(proc.exitCode).toBe(0);
      }
      const output = JSON.parse(proc.stdout.toString("utf-8"));
      expect(output.logs).toMatchSnapshot("Browser console logs");
      expect(output.domSnapshots).toMatchSnapshot("DOM Snapshots");
    });
  }
});
