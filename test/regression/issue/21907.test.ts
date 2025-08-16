import { expect, test } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles } from "harness";

test("CSS parser should handle extremely large floating-point values without crashing", async () => {
  // Test for regression of issue #21907: "integer part of floating point value out of bounds"
  // This was causing crashes on Windows when processing TailwindCSS with rounded-full class
  
  const dir = tempDirWithFiles("css-large-float-regression", {
    "input.css": `
/* Tests intFromFloat(i32, value) in serializeDimension */
.test-rounded-full {
  border-radius: 3.40282e38px;
  width: 2147483648px;
  height: -2147483649px;
}

.test-negative {
  border-radius: -3.40282e38px;
}

.test-very-large {
  border-radius: 999999999999999999999999999999999999999px;
}

.test-large-integer {
  border-radius: 340282366920938463463374607431768211456px;
}

/* Tests intFromFloat(u8, value) in color conversion */
.test-colors {
  color: rgb(300, -50, 1000);
  background: rgba(999.9, 0.1, -10.5, 1.5);
}

/* Tests intFromFloat(i32, value) in percentage handling */
.test-percentages {
  width: 999999999999999999%;
  height: -999999999999999999%;
}

/* Tests edge cases around integer boundaries */
.test-boundaries {
  margin: 2147483647px; /* i32 max */
  padding: -2147483648px; /* i32 min */
  left: 4294967295px; /* u32 max */
}

/* Tests normal values */
.test-normal {
  width: 10px;
  height: 20.5px;
  margin: 0px;
}
`
  });
  
  // This would previously crash with "integer part of floating point value out of bounds"
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "input.css", "--outdir", dir],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  
  // Should not crash and should exit successfully
  expect(exitCode).toBe(0);
  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("integer part of floating point value out of bounds");
  
  // Verify the output contains our CSS properly formatted
  const outputContent = await Bun.file(`${dir}/input.css`).text();
  
  // Should contain the large floating-point values properly serialized
  expect(outputContent).toContain("border-radius:");
  expect(outputContent).toContain("3.40282e");
  
  // Verify color values are properly clamped/converted
  expect(outputContent).toContain("color:");
  expect(outputContent).toContain("background:");
  
  // Verify percentage values are handled
  expect(outputContent).toContain("width:");
  expect(outputContent).toContain("height:");
});