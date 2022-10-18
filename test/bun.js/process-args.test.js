
import { spawn } from "bun";
import { test, expect } from "bun:test";

test("args exclude run", async () => {
    const arg_prefix = '[ "' + process.argv[0] + '", "' + import.meta.dir + '/process-args.js"';

    const { stdout: s1 } = spawn(["bun-debug", "process-args.js"], { cwd: import.meta.dir });
    const t1 = await (await new Response(s1).text()).trim();
    const e1 = new String(arg_prefix + ' ]\n').trim();
    expect(t1).toBe(e1);
    console.log(t1.length + ": " + t1);
    console.log(e1.length + ": " + e1);

    const { stdout: s4 } = spawn(["bun-debug", "process-args.js", "arg1"], { cwd: import.meta.dir });
    const t4 = (await new Response(s4).text()).trim();
    const e4 = new String(arg_prefix + ', "arg1" ]\n').trim();
    expect(t4).toBe(e4);
    console.log(t4.length + ": " + t4);
    console.log(e4.length + ": " + e4);

    const { stdout: s2 } = spawn(["bun-debug", "run", "process-args.js"], { cwd: import.meta.dir });
    const t2 = await (await new Response(s2).text()).trim();
    const e2 = new String(arg_prefix + ' ]\n').trim();
    expect(t2).toBe(e2);
    console.log(t2.length + ": " + t2);
    console.log(e2.length + ": " + e2);

    const { stdout: s3 } = spawn(["bun-debug", "run", "process-args.js", "arg1", "arg2"], { cwd: import.meta.dir });
    const t3 = await (await new Response(s3).text()).trim();
    const e3 = new String(arg_prefix + ', "arg1", "arg2" ]\n').trim();
    expect(t3).toBe(e3);
    console.log(t3.length + ": " + t3);
    console.log(e3.length + ": " + e3);
});