import { test, expect } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles } from "harness";
import { rmSync } from "fs";
import { join } from "path";

test("bundler should produce deterministic output with nested node_modules", async () => {
  // Create a more complex structure with many nested dependencies to increase chances of race conditions
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "test-app",
      dependencies: {
        "@smithy/types": "2.12.0"
      }
    }),
    "src/index.ts": `
import { client1 } from "@aws-sdk/client-sso";
import { client2 } from "@aws-sdk/client-sts";
import { client3 } from "@aws-sdk/client-s3";
import { client4 } from "@aws-sdk/client-ec2";
import { client5 } from "@aws-sdk/client-lambda";
import { smithyTypes } from "@smithy/types";

console.log(client1, client2, client3, client4, client5, smithyTypes);
`,
    "node_modules/@smithy/types/package.json": JSON.stringify({
      name: "@smithy/types",
      version: "2.12.0",
      main: "dist/index.js"
    }),
    "node_modules/@smithy/types/dist/index.js": `
export const smithyTypes = "version-2.12.0";
`,
  };

  // Add multiple AWS SDK clients to increase complexity and race conditions
  const clients = ["sso", "sts", "s3", "ec2", "lambda"];
  for (const clientName of clients) {
    const clientNum = clients.indexOf(clientName) + 1;
    
    files[`node_modules/@aws-sdk/client-${clientName}/package.json`] = JSON.stringify({
      name: `@aws-sdk/client-${clientName}`,
      version: "1.0.0", 
      main: "dist/index.js",
      dependencies: {
        "@smithy/types": "4.3.1"
      }
    });
    
    files[`node_modules/@aws-sdk/client-${clientName}/dist/index.js`] = `
import { smithyTypes } from "@smithy/types";
export const client${clientNum} = "${clientName}-client-" + smithyTypes;
`;
    
    files[`node_modules/@aws-sdk/client-${clientName}/node_modules/@smithy/types/package.json`] = JSON.stringify({
      name: "@smithy/types",
      version: "4.3.1",
      main: "dist/index.js"
    });
    
    files[`node_modules/@aws-sdk/client-${clientName}/node_modules/@smithy/types/dist/index.js`] = `
export const smithyTypes = "version-4.3.1";
`;
  }

  const testDir = tempDirWithFiles("non-deterministic-bundling", files);

  const out1Dir = join(testDir, "out1");
  const out2Dir = join(testDir, "out2");
  const out3Dir = join(testDir, "out3");

  // Clean up any existing output directories
  try {
    rmSync(out1Dir, { recursive: true, force: true });
    rmSync(out2Dir, { recursive: true, force: true });
    rmSync(out3Dir, { recursive: true, force: true });
  } catch {}

  // Bundle multiple times
  const bundleCommands = [
    [bunExe(), "build", "src/index.ts", "--outdir", "out1"],
    [bunExe(), "build", "src/index.ts", "--outdir", "out2"],
    [bunExe(), "build", "src/index.ts", "--outdir", "out3"],
  ];

  const bundleResults = await Promise.all(
    bundleCommands.map(async (cmd) => {
      const proc = Bun.spawn({
        cmd,
        cwd: testDir,
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);

      return { stdout, stderr, exitCode };
    })
  );

  // All builds should succeed
  for (const result of bundleResults) {
    expect(result.exitCode).toBe(0);
  }

  // Get file lists from each output directory  
  const getFileList = (dir: string) => {
    const proc = Bun.spawn({
      cmd: ["find", dir, "-type", "f", "-name", "*.js"],
      cwd: testDir,
      stderr: "pipe",
      stdout: "pipe",
    });
    
    return proc.stdout.text().then(text => 
      text.trim().split('\n')
        .filter(line => line)
        .map(line => line.split('/').pop()) // Get just the filename
        .sort()
    );
  };

  const [files1, files2, files3] = await Promise.all([
    getFileList("out1"),
    getFileList("out2"), 
    getFileList("out3"),
  ]);

  // File lists should be identical across all builds
  expect(files1).toEqual(files2);
  expect(files2).toEqual(files3);

  // Compare file sizes - different bundling might produce different sized files
  const getFileSize = async (dir: string, filename: string) => {
    const stat = await Bun.file(join(testDir, dir, filename)).size;
    return stat;
  };

  for (const filename of files1) {
    const size1 = await getFileSize("out1", filename);
    const size2 = await getFileSize("out2", filename); 
    const size3 = await getFileSize("out3", filename);
    
    // If bundling is non-deterministic, we might see different file sizes
    console.log(`File ${filename}: size1=${size1}, size2=${size2}, size3=${size3}`);
  }

  // Also check the actual content of main bundle file
  const content1 = await Bun.file(join(testDir, "out1/index.js")).text();
  const content2 = await Bun.file(join(testDir, "out2/index.js")).text();
  const content3 = await Bun.file(join(testDir, "out3/index.js")).text();
  
  console.log("Content 1 length:", content1.length);
  console.log("Content 2 length:", content2.length);  
  console.log("Content 3 length:", content3.length);
  
  // They should be identical if bundling is deterministic
  expect(content1).toEqual(content2);
  expect(content2).toEqual(content3);
}, 30000);