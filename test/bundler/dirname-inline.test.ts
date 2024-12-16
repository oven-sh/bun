import { describe, expect, it, beforeAll } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

describe("Server side cases", ()=>{
  let temp_dir: string
  beforeAll(()=>{
    temp_dir = tmpdirSync();
    const fdata=`
      import {readFileSync} from "fs"
      console.log(__dirname)
      console.log(readFileSync)
    `
    writeFileSync(join(temp_dir, "index.ts"), fdata, "utf-8");
  })
  it("target bun no bundle", async ()=>{
    const out = Bun.spawnSync({
      cmd: [bunExe(), "build", "--target=bun", "--no-bundle", join(temp_dir, "index.ts")],
      cwd: import.meta.dir,
      env: bunEnv,
      stderr: "inherit",
      stdin: Bun.file("/dev/null"),
    });
    const text = out.stdout.toString()
    expect(text.includes("__dirname =")).toBe(false)
  })

  it("target bun bundle", async ()=>{
    const out = Bun.spawnSync({
      cmd: [bunExe(), "build", "--target=bun", join(temp_dir, "index.ts")],
      cwd: import.meta.dir,
      env: bunEnv,
      stderr: "inherit",
      stdin: Bun.file("/dev/null"),
    });
    const text = out.stdout.toString()
    expect(text.includes("__dirname =")).toBe(false)
  })

  it("target browser", async ()=>{
    const out = Bun.spawnSync({
      cmd: [bunExe(), "build", "--target=browser", join(temp_dir, "index.ts")],
      cwd: import.meta.dir,
      env: bunEnv,
      stderr: "inherit",
      stdin: Bun.file("/dev/null"),
    });
    const text = out.stdout.toString()
    expect(text.includes("__dirname =")).toBe(true)
  })
  
})