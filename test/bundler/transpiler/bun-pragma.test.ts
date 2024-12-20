import path from "path";
import { bunExe, bunEnv } from "harness";

const fixturePath = (name: string): string => path.join(import.meta.dirname, "fixtures", name);

describe("@bun pragma", () => {
  it("is not detected when embedded in a URL", async () => {
    const res = Bun.spawn({
      cmd: [bunExe(), "run", fixturePath("bun-in-url.ts")],
      stdio: ["ignore", "ignore", "ignore"],
    });
    await res.exited;
    expect(res.exitCode).toBe(0);
  });
});
