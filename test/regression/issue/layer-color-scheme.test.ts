import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("@layer color-scheme should inject CSS variables within layer context", async () => {
  const dir = tempDirWithFiles("layer-color-scheme-test", {
    "input.css": `@layer shm.colors {
  body.theme-dark {
    color-scheme: dark;
  }

  body.theme-light {
    color-scheme: light;
  }
}`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "input.css", "--target=browser", "--minify"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // The output should contain the CSS variables within the @layer block
  expect(stdout).toContain("@layer shm.colors");
  expect(stdout).toContain("--buncss-light:");
  expect(stdout).toContain("--buncss-dark:");

  // Verify that the CSS variables are within the layer context, not outside
  const layerMatch = stdout.match(/@layer\s+shm\.colors\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/);
  expect(layerMatch).toBeTruthy();

  if (layerMatch) {
    const layerContent = layerMatch[1];
    expect(layerContent).toContain("--buncss-light:");
    expect(layerContent).toContain("--buncss-dark:");
    expect(layerContent).toContain("color-scheme:dark");
    expect(layerContent).toContain("color-scheme:light");
  }
});

test("@layer color-scheme should handle light dark scheme with media query in layer", async () => {
  const dir = tempDirWithFiles("layer-color-scheme-media-test", {
    "input.css": `@layer theme {
  .element {
    color-scheme: light dark;
  }
}`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "input.css", "--target=browser"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // Should contain the main layer with light theme variables
  expect(stdout).toContain("@layer theme");
  expect(stdout).toContain("--buncss-light:initial");
  expect(stdout).toContain("--buncss-dark:");

  // Should also contain a separate layer block with dark theme media query
  expect(stdout).toContain("@media (prefers-color-scheme:dark)");

  // The dark theme media query should also be wrapped in the same layer
  const mediaQueryMatch = stdout.match(
    /@layer\s+theme\s*\{[^}]*@media\s*\([^)]*prefers-color-scheme\s*:\s*dark[^)]*\)/,
  );
  expect(mediaQueryMatch).toBeTruthy();
});

test("color-scheme without @layer should work normally", async () => {
  const dir = tempDirWithFiles("color-scheme-no-layer-test", {
    "input.css": `body.theme-dark {
  color-scheme: dark;
}

body.theme-light {
  color-scheme: light;
}`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "input.css", "--target=browser"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // Should contain CSS variables but no @layer wrapper
  expect(stdout).toContain("--buncss-light:");
  expect(stdout).toContain("--buncss-dark:");
  expect(stdout).toContain("color-scheme:dark");
  expect(stdout).toContain("color-scheme:light");
  expect(stdout).not.toContain("@layer");
});
