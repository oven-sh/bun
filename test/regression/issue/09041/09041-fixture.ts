import { $ } from "bun";
import { join } from "path";
test("09041", async () => {
  const len = 1024 * 1024;
  const buffer = Buffer.alloc(len);
  let i = 0;
  let j = 0;
  while (i < len) {
    j += 1;
    i += buffer.write(Number(j).toString(10) + ",", i);
  }
  const buns = Array.from({ length: 5 }, () =>
    $`${process.argv0} run ${join(import.meta.dir, "09041-fixture.mjs")} < ${buffer}`.quiet(),
  );

  const runs = await Promise.all(buns);
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];

    expect(condense(buffer.toString("utf-8"))).toEqual(condense(run.stdout.toString("utf-8")));
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toHaveLength(len);
    expect(run.stdout).toEqual(buffer);
  }
}, 30000);

function condense(str: string) {
  const nums = str.split(",").map(n => +n);
  let out: { len: number; start: number | string }[] = [];
  for (let i = 0; i < nums.length; i++) {
    const val = nums[i]!;
    const last = out[out.length - 1];
    if (typeof val === "number" && last && typeof last.start === "number" && last.start + last.len === val) {
      last.len++;
      continue;
    }
    out.push({ len: 1, start: val });
  }
  return out.map(o => (o.len === 1 ? `${o.start}` : `${o.start}-${(o.start as number) + o.len - 1}`)).join(",");
}
