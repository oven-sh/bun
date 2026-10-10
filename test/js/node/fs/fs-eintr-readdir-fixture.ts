// Run by fs-eintr-linux.test.ts, in an empty directory, under a shim that
// fails one getdents64 of each "eintr-*" directory with EINTR.
import fs from "node:fs";
import path from "node:path";

function make(name: string) {
  fs.mkdirSync(name);
  for (const file of ["a.txt", "b.txt", "c.txt"]) fs.writeFileSync(path.join(name, file), "");
  return name;
}

async function read(dir: string, fn: (dir: string) => string[] | Promise<string[]>) {
  let entries;
  try {
    entries = (await fn(dir)).map(String).sort();
  } catch (e: any) {
    entries = { code: e.code, syscall: e.syscall };
  }
  return { entries, interrupted: fs.existsSync(dir + ".interrupted") };
}

const out: Record<string, unknown> = {};
for (const when of ["first", "second"]) {
  out[when] = {
    readdirSync: await read(make(`eintr-${when}-sync`), dir => fs.readdirSync(dir)),
    readdir: await read(make(`eintr-${when}-async`), dir => fs.promises.readdir(dir)),
    opendirSync: await read(make(`eintr-${when}-opendir`), dir => {
      const handle = fs.opendirSync(dir);
      const names: string[] = [];
      try {
        for (let entry; (entry = handle.readSync()); ) names.push(entry.name);
      } finally {
        handle.closeSync();
      }
      return names;
    }),
    glob: await read(make(`eintr-${when}-glob`), dir => [...new Bun.Glob("*").scanSync({ cwd: dir })]),
  };
}
console.log(JSON.stringify(out));
