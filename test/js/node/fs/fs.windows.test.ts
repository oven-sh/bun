import fs from "node:fs/promises";
import { test as testReal, expect } from "bun:test";

const test = process.platform !== "win32" ? testReal.skip : testReal;

{
  const file = import.meta.path.slice(3);
  const drive = import.meta.path[0];
  const filenames = [
    `${drive}:\\${file}`,
    `\\\\127.0.0.1\\${drive}$\\${file}`,
    `\\\\LOCALHOST\\${drive}$\\${file}`,
    `\\\\.\\${drive}:\\${file}`,
    `\\\\?\\${drive}:\\${file}`,
    `\\\\.\\UNC\\LOCALHOST\\${drive}$\\${file}`,
    `\\\\?\\UNC\\LOCALHOST\\${drive}$\\${file}`,
    `\\\\127.0.0.1\\${drive}$\\${file}`,
  ];

  for (const filename of filenames) {
    test(`Can read '${filename}' with node:fs`, async () => {
      const stats = await fs.stat(filename);
      expect(stats.size).toBeGreaterThan(0);
    });
    test(`Can read '${filename}' with bun.file`, async () => {
      const stats = await Bun.file(filename).text();
      expect(stats.length).toBeGreaterThan(0);
    });
  }
}
