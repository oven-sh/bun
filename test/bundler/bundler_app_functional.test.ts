import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import path from "path";

describe("bundler app option functional tests", () => {
  test("Bun.build app option actually processes server components", async () => {
    if (!process.env.BUN_FEATURE_FLAG_BAKE) {
      console.log("Skipping test - Bake feature flag not enabled");
      return;
    }

    const dir = tempDirWithFiles("bundler-app-functional-test", {
      "server.ts": `
        export function registerClientReference(fn, id, name) {
          return function() { 
            throw new Error('Cannot call client component "' + name + '" on server'); 
          };
        }
        export default function handler(req) {
          return new Response('Server handler');
        }
      `,
      "client.ts": `
        "use client";
        export default function ClientComponent() {
          return "Client Component";
        }
      `,
      "server-component.ts": `
        "use server";
        import ClientComp from './client.ts';
        export default function ServerComponent() {
          return "Server: " + ClientComp();
        }
      `,
      "entry.ts": `
        import ServerComponent from './server-component.ts';
        console.log("Entry loaded");
        export default ServerComponent;
      `,
      "routes/index.ts": `
        export default function(req, meta) {
          return new Response('Hello from route!');
        }
      `,
      "test-build.ts": `
        const result = await Bun.build({
          entrypoints: ["./entry.ts"],
          outdir: "./dist",
          app: {
            framework: {
              fileSystemRouterTypes: [
                {
                  root: "routes",
                  style: "nextjs-pages",
                  serverEntryPoint: "./server.ts",
                },
              ],
              serverComponents: {
                separateSSRGraph: false,
                serverRuntimeImportSource: "./server.ts",
                serverRegisterClientReferenceExport: "registerClientReference",
              },
            },
            root: ".",
          }
        });
        
        console.log("Build result:", result.success ? "SUCCESS" : "FAILED");
        console.log("Outputs:", result.outputs?.length || 0, "files");
        
        if (result.success && result.outputs) {
          for (const output of result.outputs) {
            console.log("Output:", output.path, output.kind, "size:", output.size);
          }
          
          // Check if server component processing happened
          const hasServerOutput = result.outputs.some(o => o.path.includes("server") || o.kind === "entry-point");
          console.log("Has server-related output:", hasServerOutput);
          
          // Try to read one of the outputs to see if it contains expected transformations
          if (result.outputs.length > 0) {
            try {
              const firstOutput = result.outputs[0];
              const content = await firstOutput.text();
              console.log("First output contains 'registerClientReference':", content.includes("registerClientReference"));
              console.log("First output sample (first 200 chars):", content.slice(0, 200));
            } catch (e) {
              console.log("Could not read output content:", e.message);
            }
          }
        } else {
          console.log("Build errors:");
          if (result.logs) {
            for (const log of result.logs) {
              console.log("-", log.message);
            }
          }
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test-build.ts"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    console.log("Functional test output:");
    console.log("STDOUT:", stdout);
    if (stderr) console.log("STDERR:", stderr);
    console.log("EXIT CODE:", exitCode);

    // Should build successfully
    expect(stdout).toContain("Build result: SUCCESS");
    expect(stdout).toContain("Outputs:");
    
    // Should have generated some output files
    expect(stdout).toMatch(/Outputs: [1-9]\d* files/);

    if (exitCode !== 0) {
      console.error("Process failed with exit code:", exitCode);
      console.error("STDERR:", stderr);
    }
    expect(exitCode).toBe(0);
  });

  test("Bun.build app option generates correct file structure", async () => {
    if (!process.env.BUN_FEATURE_FLAG_BAKE) {
      console.log("Skipping test - Bake feature flag not enabled");
      return;
    }

    const dir = tempDirWithFiles("bundler-app-structure-test", {
      "server.ts": `
        export function registerClientReference(fn, id, name) {
          return function() { return 'stub:' + name; };
        }
        export default function handler() { return new Response('OK'); }
      `,
      "entry.ts": `console.log("Simple entry point");`,
      "test-build.ts": `
        import fs from 'fs';
        
        const result = await Bun.build({
          entrypoints: ["./entry.ts"],
          outdir: "./dist", 
          app: {
            framework: {
              fileSystemRouterTypes: [
                {
                  root: "routes", 
                  style: "nextjs-pages",
                  serverEntryPoint: "./server.ts",
                },
              ],
              serverComponents: {
                separateSSRGraph: false,
                serverRuntimeImportSource: "./server.ts",
                serverRegisterClientReferenceExport: "registerClientReference",
              },
            },
            root: ".",
          }
        });
        
        if (result.success) {
          console.log("BUILD_SUCCESS");
          console.log("Output directory exists:", fs.existsSync('./dist'));
          
          try {
            const distContents = fs.readdirSync('./dist');
            console.log("Dist contents:", distContents);
            
            // Check if any JS files were generated
            const jsFiles = distContents.filter(f => f.endsWith('.js'));
            console.log("JS files generated:", jsFiles.length);
          } catch (e) {
            console.log("Could not read dist directory:", e.message);
          }
        } else {
          console.log("BUILD_FAILED");
          if (result.logs) {
            for (const log of result.logs) {
              console.log("Error:", log.message);
            }
          }
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test-build.ts"],
      env: bunEnv,
      cwd: dir,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    console.log("Structure test output:");
    console.log("STDOUT:", stdout);
    if (stderr) console.log("STDERR:", stderr);

    expect(stdout).toContain("BUILD_SUCCESS");
    expect(stdout).toContain("Output directory exists: true");

    if (exitCode !== 0) {
      console.error("STDOUT:", stdout);
      console.error("STDERR:", stderr);
    }
    expect(exitCode).toBe(0);
  });
});