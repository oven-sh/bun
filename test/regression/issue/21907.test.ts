import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

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
`,
  });

  // This would previously crash with "integer part of floating point value out of bounds"
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "input.css", "--outdir", "out"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should not crash and should exit successfully
  expect(exitCode).toBe(0);
  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("integer part of floating point value out of bounds");

  // Verify the output CSS is properly processed with intFromFloat conversions
  const outputContent = await Bun.file(`${dir}/out/input.css`).text();

  // Helper function to normalize CSS output for snapshots
  function normalizeCSSOutput(output: string): string {
    return output
      .replace(/\/\*.*?\*\//g, "/* [path] */") // Replace comment paths
      .trim();
  }

  // Test the actual output with inline snapshot - this ensures all intFromFloat
  // conversions work correctly and captures any changes in output format
  expect(normalizeCSSOutput(outputContent)).toMatchInlineSnapshot(`
    "/* [path] */
    .test-rounded-full {
      border-radius: 3.40282e+38px;
      width: 2147480000px;
      height: -2147480000px;
    }

    .test-negative {
      border-radius: -3.40282e+38px;
    }

    .test-very-large, .test-large-integer {
      border-radius: 3.40282e38px;
    }

    .test-colors {
      color: #f0f;
      background: red;
    }

    .test-percentages {
      width: 1000000000000000000%;
      height: -1000000000000000000%;
    }

    .test-boundaries {
      margin: 2147480000px;
      padding: -2147480000px;
      left: 4294970000px;
    }

    .test-normal {
      width: 10px;
      height: 20.5px;
      margin: 0;
    }"
  `);
});
