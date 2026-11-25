// Builds data-files.json.gz from data-files.txt with the tools of ICU4C (genrb, genbrk, gendict, gennorm2, icupkg), which
// have to be in PATH:
//
//   ICU_DATA=<the directory of icudt79l.dat> bun build-data-files.ts
//
// In data-files.txt, "-- directory/path --" begins a file. directory/make.sh builds a directory. Without it, each
// path/name.txt is the source of icudt79l/path/name.res.
import { $, Glob } from "bun";
import { tempDir } from "harness";
import { basename, dirname, join } from "node:path";
import { dataFiles, type DataFiles } from "./observe";

const [, ...parts] = (await Bun.file(join(import.meta.dir, "data-files.txt")).text()).split(/^-- (\S+) --\n/m);
const sources: Record<string, Record<string, string>> = {};
for (let i = 0; i < parts.length; i += 2) {
  const [directory, ...path] = parts[i].split("/");
  (sources[directory] ??= {})[path.join("/")] = parts[i + 1];
}

const built: DataFiles = {};
for (const [name, texts] of Object.entries(sources)) {
  using directory = tempDir("data-files", texts);
  $.cwd(String(directory));
  if ("make.sh" in texts) await $`sh -e make.sh`;
  else {
    for (const path in texts) {
      const to = join("icudt79l", dirname(path));
      await $`mkdir -p ${to} && genrb -q -e UTF-8 -s ${dirname(path)} -d ${to} ${basename(path)}`;
    }
  }
  built[name] = {};
  for (const path of [...new Glob("**").scanSync({ cwd: String(directory), dot: true })].sort()) {
    if (!(path in texts)) built[name][path] = (await Bun.file(join(String(directory), path)).bytes()).toBase64();
  }
}

await Bun.write(dataFiles, Bun.gzipSync(Buffer.from(JSON.stringify(built)), { level: 9 }));
