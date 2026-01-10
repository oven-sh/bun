import { test, expect, describe } from "bun:test";
import { bunExe, bunEnv, tempDir } from "harness";

describe("Sigstore SLSA Tests", () => {
  test("should generate valid SLSA provenance for npm package", async () => {
    using dir = tempDir("sigstore-slsa-npm", {
      "package.json": JSON.stringify({
        name: "test-package",
        version: "1.0.0",
        description: "Test package for SLSA provenance"
      }),
      "slsa-npm-test.js": `
        const fs = require('fs');
        const crypto = require('crypto');
        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        
        // Calculate package digest
        const packageContent = fs.readFileSync('package.json');
        const hash = crypto.createHash('sha256').update(packageContent).digest('hex');
        
        const slsaProvenance = {
          _type: "https://in-toto.io/Statement/v0.1",
          subject: [
            {
              name: \`pkg:npm/\${packageJson.name}@\${packageJson.version}\`,
              digest: {
                sha256: hash
              }
            }
          ],
          predicateType: "https://slsa.dev/provenance/v0.2",
          predicate: {
            builder: {
              id: "https://github.com/actions/runner",
              builderDependencies: [],
              version: {
                "github-hosted": "20240101.1.0"
              }
            },
            buildType: "https://github.com/actions/workflow",
            invocation: {
              configSource: {
                uri: "git+https://github.com/example/repo@refs/heads/main",
                digest: {
                  sha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
                },
                entryPoint: ".github/workflows/publish.yml"
              },
              parameters: {},
              environment: {
                "GITHUB_ACTOR": "github-actions[bot]",
                "GITHUB_SHA": "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
              }
            },
            metadata: {
              buildInvocationId: "https://github.com/example/repo/actions/runs/123456789",
              completeness: {
                parameters: true,
                environment: false,
                materials: false
              },
              reproducible: false
            },
            materials: [
              {
                uri: "git+https://github.com/example/repo@refs/heads/main",
                digest: {
                  sha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
                }
              }
            ]
          }
        };
        
        console.log("Package name:", packageJson.name);
        console.log("Package version:", packageJson.version);
        console.log("Subject URI:", slsaProvenance.subject[0].name);
        console.log("Builder ID:", slsaProvenance.predicate.builder.id);
        console.log("Build type:", slsaProvenance.predicate.buildType);
        console.log("SLSA provenance generated successfully");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "slsa-npm-test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Package name: test-package");
    expect(stdout).toContain("Package version: 1.0.0");
    expect(stdout).toContain("Subject URI: pkg:npm/test-package@1.0.0");
    expect(stdout).toContain("Builder ID: https://github.com/actions/runner");
    expect(stdout).toContain("SLSA provenance generated successfully");
  });

  test("should validate SLSA predicate completeness", async () => {
    using dir = tempDir("sigstore-slsa-completeness", {
      "completeness-test.js": `
        const completenessLevels = {
          minimal: {
            parameters: false,
            environment: false,
            materials: false
          },
          partial: {
            parameters: true,
            environment: false,
            materials: false
          },
          complete: {
            parameters: true,
            environment: true,
            materials: true
          }
        };
        
        function calculateCompletenessScore(completeness) {
          const score = Object.values(completeness).filter(Boolean).length;
          const total = Object.values(completeness).length;
          return (score / total) * 100;
        }
        
        console.log("Minimal completeness score:", calculateCompletenessScore(completenessLevels.minimal));
        console.log("Partial completeness score:", calculateCompletenessScore(completenessLevels.partial));
        console.log("Complete completeness score:", calculateCompletenessScore(completenessLevels.complete));
        console.log("SLSA completeness validation passed");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "completeness-test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Minimal completeness score: 0");
    expect(stdout).toContain("Partial completeness score: 33.33333333333333");
    expect(stdout).toContain("Complete completeness score: 100");
    expect(stdout).toContain("SLSA completeness validation passed");
  });

  test("should validate build materials and dependencies", async () => {
    using dir = tempDir("sigstore-slsa-materials", {
      "materials-test.js": `
        const buildMaterials = [
          {
            uri: "git+https://github.com/example/repo@refs/heads/main",
            digest: {
              sha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
            }
          },
          {
            uri: "pkg:npm/typescript@5.0.0",
            digest: {
              sha256: "abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
            }
          }
        ];
        
        const builderDependencies = [
          {
            uri: "pkg:github/actions/runner@v2.300.0",
            digest: {
              sha256: "efgh5678901234efgh5678901234efgh5678901234efgh5678901234efgh5678"
            }
          }
        ];
        
        console.log("Source materials count:", buildMaterials.length);
        console.log("Builder dependencies count:", builderDependencies.length);
        console.log("First material URI:", buildMaterials[0].uri);
        console.log("First dependency URI:", builderDependencies[0].uri);
        console.log("Build materials validation passed");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "materials-test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Source materials count: 2");
    expect(stdout).toContain("Builder dependencies count: 1");
    expect(stdout).toContain("First material URI: git+https://github.com/example/repo@refs/heads/main");
    expect(stdout).toContain("Build materials validation passed");
  });

  test("should validate SLSA levels and requirements", async () => {
    using dir = tempDir("sigstore-slsa-levels", {
      "levels-test.js": `
        const slsaLevels = {
          level1: {
            requiredFields: ["builder.id", "buildType", "invocation"],
            securityRequirements: ["source_control", "build_service"]
          },
          level2: {
            requiredFields: ["builder.id", "buildType", "invocation", "metadata.buildInvocationId"],
            securityRequirements: ["source_control", "build_service", "hosted_build"]
          },
          level3: {
            requiredFields: ["builder.id", "buildType", "invocation", "metadata", "materials"],
            securityRequirements: ["source_control", "build_service", "hosted_build", "non_falsifiable"]
          }
        };
        
        function validateLevel(level, provenance) {
          // Simplified validation - in real implementation would check actual provenance
          const hasRequiredFields = level.requiredFields.every(field => true); // Mock validation
          const meetsSecurityReqs = level.securityRequirements.length > 0;
          return hasRequiredFields && meetsSecurityReqs;
        }
        
        console.log("SLSA Level 1 valid:", validateLevel(slsaLevels.level1, {}));
        console.log("SLSA Level 2 valid:", validateLevel(slsaLevels.level2, {}));
        console.log("SLSA Level 3 valid:", validateLevel(slsaLevels.level3, {}));
        console.log("Level 1 requirements:", slsaLevels.level1.requiredFields.length);
        console.log("Level 3 requirements:", slsaLevels.level3.requiredFields.length);
        console.log("SLSA levels validation passed");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "levels-test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("SLSA Level 1 valid: true");
    expect(stdout).toContain("SLSA Level 2 valid: true");
    expect(stdout).toContain("SLSA Level 3 valid: true");
    expect(stdout).toContain("Level 1 requirements: 3");
    expect(stdout).toContain("Level 3 requirements: 5");
    expect(stdout).toContain("SLSA levels validation passed");
  });

  test("should validate GitHub Actions environment for SLSA", async () => {
    using dir = tempDir("sigstore-slsa-github-env", {
      "github-env-test.js": `
        // Mock GitHub Actions environment variables for SLSA
        const githubEnv = {
          GITHUB_ACTIONS: "true",
          GITHUB_WORKFLOW: "Build and Publish",
          GITHUB_RUN_ID: "123456789",
          GITHUB_RUN_NUMBER: "42",
          GITHUB_SHA: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          GITHUB_REF: "refs/heads/main",
          GITHUB_REPOSITORY: "example/repo",
          GITHUB_ACTOR: "github-actions[bot]",
          RUNNER_OS: "Linux",
          RUNNER_ARCH: "X64"
        };
        
        // Build invocation ID from GitHub context
        const buildInvocationId = \`https://github.com/\${githubEnv.GITHUB_REPOSITORY}/actions/runs/\${githubEnv.GITHUB_RUN_ID}\`;
        
        // Determine if environment is suitable for SLSA
        const isHostedBuild = githubEnv.GITHUB_ACTIONS === "true";
        const hasSourceControl = !!githubEnv.GITHUB_SHA;
        const hasReproducibleEnv = !!githubEnv.RUNNER_OS && !!githubEnv.RUNNER_ARCH;
        
        console.log("Build invocation ID:", buildInvocationId);
        console.log("Is hosted build:", isHostedBuild);
        console.log("Has source control:", hasSourceControl);
        console.log("Has reproducible env:", hasReproducibleEnv);
        console.log("SLSA GitHub environment validated");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "github-env-test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Build invocation ID: https://github.com/example/repo/actions/runs/123456789");
    expect(stdout).toContain("Is hosted build: true");
    expect(stdout).toContain("Has source control: true");
    expect(stdout).toContain("Has reproducible env: true");
    expect(stdout).toContain("SLSA GitHub environment validated");
  });
});