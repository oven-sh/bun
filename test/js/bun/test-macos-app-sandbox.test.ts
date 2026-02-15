import { describe, expect, test } from "bun:test";
import { copyFileSync, rmSync } from "fs";
import { homedir } from "os";
import { bunEnv, bunExe, isMacOS, tempDir } from "harness";
import { join } from "path";

const entitlementsPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.app-sandbox</key>
	<true/>
	<key>com.apple.security.cs.allow-jit</key>
	<true/>
	<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
	<true/>
	<key>com.apple.security.cs.disable-executable-page-protection</key>
	<true/>
	<key>com.apple.security.cs.disable-library-validation</key>
	<true/>
</dict>
</plist>`;

function makeInfoPlist(bundleId: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>bun</string>
	<key>CFBundleIdentifier</key>
	<string>${bundleId}</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>bun_sandboxed</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundleSupportedPlatforms</key>
	<array>
		<string>MacOSX</string>
	</array>
	<key>CFBundleVersion</key>
	<string>1</string>
</dict>
</plist>`;
}

async function createSandboxedApp(prefix: string, bundleId: string) {
  const dir = tempDir(prefix, {
    "entitlements.plist": entitlementsPlist,
    "bun_sandboxed.app": {
      "Contents": {
        "Info.plist": makeInfoPlist(bundleId),
        "MacOS": {},
      },
    },
  });

  const bunPath = join(String(dir), "bun_sandboxed.app", "Contents", "MacOS", "bun");
  const appBundlePath = join(String(dir), "bun_sandboxed.app");
  const entitlementsPath = join(String(dir), "entitlements.plist");

  copyFileSync(bunExe(), bunPath);

  await using codesign = Bun.spawn({
    cmd: ["/usr/bin/codesign", "--entitlements", entitlementsPath, "--force", "-s", "-", appBundlePath],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  expect(await codesign.exited).toBe(0);

  return { dir, bunPath, bundleId, containerPath: join(homedir(), "Library", "Containers", bundleId) };
}

// Modeled after Node.js's test/parallel/test-macos-app-sandbox.js
describe.skipIf(!isMacOS)("macOS App Sandbox", () => {
  test.concurrent("bun can execute JavaScript inside the app sandbox", async () => {
    const { dir, bunPath, containerPath } = await createSandboxedApp("macos-sandbox-test", "dev.bun.test.sandbox_exec");
    using _dir = dir;

    try {
      await using proc = Bun.spawn({
        cmd: [bunPath, "-e", "console.log('hello sandbox')"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      expect(stdout.trim()).toBe("hello sandbox");
      expect(exitCode).toBe(0);
    } finally {
      rmSync(containerPath, { recursive: true, force: true });
    }
  });

  test.concurrent("sandboxed bun runs inside the sandbox container", async () => {
    const { dir, bunPath, bundleId, containerPath } = await createSandboxedApp(
      "macos-sandbox-test-container",
      "dev.bun.test.sandbox_container",
    );
    using _dir = dir;

    try {
      // When running inside a macOS App Sandbox, os.homedir() should return
      // the sandbox container path, not the real home directory.
      await using proc = Bun.spawn({
        cmd: [bunPath, "-e", "console.log(require('os').homedir())"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });

      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

      expect(stdout.trim()).toContain(`Library/Containers/${bundleId}`);
      expect(exitCode).toBe(0);
    } finally {
      rmSync(containerPath, { recursive: true, force: true });
    }
  });
});
