import { describe, expect, test } from "bun:test";
import { copyFileSync } from "fs";
import { bunEnv, bunExe, isMacOS, tempDir } from "harness";
import { join } from "path";

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>bun</string>
	<key>CFBundleIdentifier</key>
	<string>dev.bun.test.bun_sandboxed</string>
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

async function createSandboxedApp(prefix: string) {
  const dir = tempDir(prefix, {
    "entitlements.plist": entitlementsPlist,
    "bun_sandboxed.app": {
      "Contents": {
        "Info.plist": infoPlist,
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
    stderr: "pipe",
  });
  expect(await codesign.exited).toBe(0);

  return { dir, bunPath };
}

// Modeled after Node.js's test/parallel/test-macos-app-sandbox.js
describe.skipIf(!isMacOS)("macOS App Sandbox", () => {
  test.concurrent("bun can execute JavaScript inside the app sandbox", async () => {
    const { dir, bunPath } = await createSandboxedApp("macos-sandbox-test");
    using _dir = dir;

    await using proc = Bun.spawn({
      cmd: [bunPath, "-e", "console.log('hello sandbox')"],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("hello sandbox");
    expect(exitCode).toBe(0);
  });

  test.concurrent("sandboxed bun runs inside the sandbox container", async () => {
    const { dir, bunPath } = await createSandboxedApp("macos-sandbox-test-container");
    using _dir = dir;

    // When running inside a macOS App Sandbox, os.homedir() should return
    // the sandbox container path, not the real home directory.
    await using proc = Bun.spawn({
      cmd: [bunPath, "-e", "console.log(require('os').homedir())"],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toContain("Library/Containers/dev.bun.test.bun_sandboxed");
    expect(exitCode).toBe(0);
  });
});
