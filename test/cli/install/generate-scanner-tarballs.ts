#!/usr/bin/env bun
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const __dirname = dirname(Bun.fileURLToPath(import.meta.url));

async function createScannerTarball(behavior: "clean" | "warn" | "fatal") {
  const tmpDir = await mkdtemp(join(tmpdir(), `test-security-scanner-${behavior}-`));
  const outputPath = join(__dirname, `test-security-scanner-1.0.0-${behavior}.tgz`);

  try {
    await mkdir(`${tmpDir}/package`, { recursive: true });

    await Bun.write(
      `${tmpDir}/package/package.json`,
      JSON.stringify({
        name: "test-security-scanner",
        version: "1.0.0",
        main: "index.js",
        type: "module",
      }),
    );

    const scannerCode = `export const scanner = {
  version: "1",
  scan: async function(payload) {
    console.error("SCANNER_RAN: " + payload.packages.length + " packages");
    const results = [];
    ${
      behavior === "warn"
        ? `if (payload.packages.length > 0) {
      results.push({
        package: payload.packages[0].name,
        level: "warn",
        description: "Test warning"
      });
    }`
        : ""
    }
    ${
      behavior === "fatal"
        ? `if (payload.packages.length > 0) {
      results.push({
        package: payload.packages[0].name,
        level: "fatal",
        description: "Test fatal error"
      });
    }`
        : ""
    }
    return results;
  }
};`;

    await Bun.write(`${tmpDir}/package/index.js`, scannerCode);

    await Bun.$`tar czf ${outputPath} -C ${tmpDir} package`;
    await Bun.$`rm -rf ${tmpDir}`;

    console.log(`Created ${outputPath}`);
  } catch (error) {
    console.error(`Failed to create scanner tarball for ${behavior}:`, error);
    throw error;
  }
}

console.log("Generating scanner tarballs...");

await Promise.all([createScannerTarball("clean"), createScannerTarball("warn"), createScannerTarball("fatal")]);

console.log("All scanner tarballs generated successfully!");
