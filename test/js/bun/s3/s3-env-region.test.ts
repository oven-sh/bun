import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Bun.S3Client reads region from the process environment once and caches it,
// so each case spawns a fresh process with only the env var under test set.
describe("Bun.S3Client region from environment", () => {
  const script = `
    const s3 = new Bun.S3Client({ bucket: "b", endpoint: "https://s3.example.invalid" });
    const url = new URL(s3.presign("k", { expiresIn: 60 }));
    process.stdout.write(url.searchParams.get("X-Amz-Credential"));
  `;

  const baseEnv = {
    ...bunEnv,
    S3_REGION: undefined,
    AWS_REGION: undefined,
    AWS_DEFAULT_REGION: undefined,
    S3_ENDPOINT: undefined,
    AWS_ENDPOINT: undefined,
    AWS_ACCESS_KEY_ID: "AK",
    AWS_SECRET_ACCESS_KEY: "SK",
  };

  async function credentialScope(env: Record<string, string | undefined>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...baseEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toMatch(/^AK\/\d{8}\/[^/]+\/s3\/aws4_request$/);
    expect(exitCode).toBe(0);
    return stdout.split("/")[2];
  }

  test.concurrent("AWS_DEFAULT_REGION is honored when no other region is set", async () => {
    expect(await credentialScope({ AWS_DEFAULT_REGION: "eu-west-1" })).toBe("eu-west-1");
  });

  test.concurrent("AWS_REGION takes precedence over AWS_DEFAULT_REGION", async () => {
    expect(
      await credentialScope({
        AWS_REGION: "us-west-2",
        AWS_DEFAULT_REGION: "eu-west-1",
      }),
    ).toBe("us-west-2");
  });

  test.concurrent("S3_REGION takes precedence over AWS_REGION and AWS_DEFAULT_REGION", async () => {
    expect(
      await credentialScope({
        S3_REGION: "ap-south-1",
        AWS_REGION: "us-west-2",
        AWS_DEFAULT_REGION: "eu-west-1",
      }),
    ).toBe("ap-south-1");
  });

  test.concurrent("explicit region option overrides all region environment variables", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const s3 = new Bun.S3Client({ bucket: "b", endpoint: "https://s3.example.invalid", region: "ca-central-1" });
          const url = new URL(s3.presign("k", { expiresIn: 60 }));
          process.stdout.write(url.searchParams.get("X-Amz-Credential").split("/")[2]);
        `,
      ],
      env: {
        ...baseEnv,
        S3_REGION: "ap-south-1",
        AWS_REGION: "us-west-2",
        AWS_DEFAULT_REGION: "eu-west-1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ca-central-1");
    expect(exitCode).toBe(0);
  });
});
