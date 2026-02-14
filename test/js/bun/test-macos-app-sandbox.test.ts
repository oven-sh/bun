import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const isMacOS = process.platform === "darwin";

// Modeled after Node.js's test/parallel/test-macos-app-sandbox.js
describe.skipIf(!isMacOS)("macOS App Sandbox", () => {
  test("bun can execute JavaScript inside the app sandbox", () => {
    using dir = tempDir("macos-sandbox-test");

    const appBundlePath = join(String(dir), "bun_sandboxed.app");
    const contentsPath = join(appBundlePath, "Contents");
    const macOSPath = join(contentsPath, "MacOS");
    const bunPath = join(macOSPath, "bun");

    // Create app bundle structure:
    // bun_sandboxed.app/
    // └── Contents
    //     ├── Info.plist
    //     └── MacOS
    //         └── bun
    mkdirSync(appBundlePath);
    mkdirSync(contentsPath);
    mkdirSync(macOSPath);

    writeFileSync(
      join(contentsPath, "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
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
</plist>`,
    );

    const entitlementsPath = join(String(dir), "entitlements.plist");
    writeFileSync(
      entitlementsPath,
      `<?xml version="1.0" encoding="UTF-8"?>
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
</plist>`,
    );

    // Copy the bun binary into the app bundle
    copyFileSync(bunExe(), bunPath);

    // Sign the app bundle with sandbox entitlements
    const codesignResult = Bun.spawnSync({
      cmd: ["/usr/bin/codesign", "--entitlements", entitlementsPath, "--force", "-s", "-", appBundlePath],
      env: bunEnv,
      stderr: "pipe",
    });
    expect(codesignResult.exitCode).toBe(0);

    // Run bun inside the sandbox
    const result = Bun.spawnSync({
      cmd: [bunPath, "-e", "console.log('hello sandbox')"],
      env: bunEnv,
      stderr: "pipe",
    });

    const stdout = result.stdout.toString().trim();
    const stderr = result.stderr.toString();

    // Assert stdout before exit code for better error messages
    expect(stdout).toBe("hello sandbox");
    expect(result.exitCode).toBe(0);
  });

  test("sandboxed bun cannot read the home directory", () => {
    using dir = tempDir("macos-sandbox-test-homedir");

    const appBundlePath = join(String(dir), "bun_sandboxed.app");
    const contentsPath = join(appBundlePath, "Contents");
    const macOSPath = join(contentsPath, "MacOS");
    const bunPath = join(macOSPath, "bun");

    mkdirSync(appBundlePath);
    mkdirSync(contentsPath);
    mkdirSync(macOSPath);

    writeFileSync(
      join(contentsPath, "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
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
</plist>`,
    );

    const entitlementsPath = join(String(dir), "entitlements.plist");
    writeFileSync(
      entitlementsPath,
      `<?xml version="1.0" encoding="UTF-8"?>
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
</plist>`,
    );

    copyFileSync(bunExe(), bunPath);

    const codesignResult = Bun.spawnSync({
      cmd: ["/usr/bin/codesign", "--entitlements", entitlementsPath, "--force", "-s", "-", appBundlePath],
      env: bunEnv,
      stderr: "pipe",
    });
    expect(codesignResult.exitCode).toBe(0);

    // Sandboxed app should not be able to read the home directory.
    // Print a marker first to confirm the process started successfully
    // before the sandboxed filesystem access fails.
    const homedir = Bun.env.HOME ?? "/Users";
    const result = Bun.spawnSync({
      cmd: [
        bunPath,
        "-e",
        `process.stdout.write("SANDBOX_START\\n"); require('fs').readdirSync(${JSON.stringify(homedir)})`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const stdout = result.stdout.toString();
    expect(stdout).toContain("SANDBOX_START");
    expect(result.exitCode).not.toBe(0);
  });
});
