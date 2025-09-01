import { expect } from "bun:test";
import { devTest, minimalFramework } from "../bake-harness";

devTest("error reporting is enabled by default", {
  framework: minimalFramework,
  files: {
    "bun.app.ts": `
export default {
  port: 0,
  app: {
    framework: {
      fileSystemRouterTypes: [
        {
          type: "file",
          dir: "./routes",
          extensions: [".ts", ".tsx"],
          style: "nextjs",
        },
      ],
    },
  }
};
`,
    "routes/error.ts": `
export default function (req, meta) {
  throw new Error("Test error");
}
`,
  },
  async test(dev) {
    const capturedLogs: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args) => {
      capturedLogs.push(args.join(" "));
      originalConsoleError(...args);
    };

    try {
      const response = await dev.fetch("/error");
      expect(response.status).toBe(500);

      // Wait a bit for the error to be logged
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify that error was logged to console
      expect(capturedLogs.some(log => log.includes("Test error"))).toBe(true);
    } finally {
      console.error = originalConsoleError;
    }
  },
});

devTest("console: false disables error reporting", {
  framework: minimalFramework,
  files: {
    "bun.app.ts": `
export default {
  port: 0,
  app: {
    framework: {
      fileSystemRouterTypes: [
        {
          type: "file",
          dir: "./routes",
          extensions: [".ts", ".tsx"],
          style: "nextjs",
        },
      ],
    },
  },
  development: {
    console: false,
  },
};
`,
    "routes/error.ts": `
export default function (req, meta) {
  throw new Error("Test error");
}
`,
  },
  async test(dev) {
    const capturedLogs: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args) => {
      capturedLogs.push(args.join(" "));
      originalConsoleError(...args);
    };

    try {
      const response = await dev.fetch("/error");
      expect(response.status).toBe(500);

      // Wait a bit to see if error gets logged
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify that error was NOT logged to console
      expect(capturedLogs.some(log => log.includes("Test error"))).toBe(false);
    } finally {
      console.error = originalConsoleError;
    }
  },
});
