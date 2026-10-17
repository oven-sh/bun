// An object literal cast to a type while missing some of its required members works as a stand-in: a member it lacks reads as undefined.
interface Host {
  os: string;
  arch: string;
}
interface Config {
  host: Host;
  unix: boolean;
  os: "linux" | "darwin";
  linux: boolean;
  darwin: boolean;
  abi: "gnu" | "musl" | undefined;
  release: boolean;
  buildDir: string;
  version: string;
}

const standIn = (overrides: Partial<Config> = {}) =>
  ({
    linux: true,
    darwin: false,
    abi: "gnu",
    release: true,
    buildDir: "/tmp/build",
    host: { os: "linux" },
    ...overrides,
  }) as Config;
const darwin = { linux: false, darwin: true, abi: undefined } as Partial<Config>;
const small = { release: true, linux: true, darwin: false, buildDir: "/small" } as Config;
const whole: Config = { host: { os: "linux", arch: "x64" }, unix: true, os: "linux", linux: true, darwin: false, abi: "musl", release: true, buildDir: "/whole", version: "1" };

function uses(config: Config): boolean {
  return config.release && (config.linux || config.darwin) && config.abi !== "musl";
}
function path(config: Config): string {
  return config.buildDir + "/linker.order";
}
console.log(uses(standIn()), uses(standIn(darwin)), uses(standIn({ release: false })), uses(standIn({ abi: "musl" })), uses(small), uses(whole));
console.log(path(standIn()), path(small), path(whole));

// Functions kept in fields are called with the stand-in too.
const flags: { when?: (config: Config) => boolean; flag: string | ((config: Config) => string) }[] = [
  { flag: "-a" },
  { when: config => config.linux, flag: config => "-order=" + path(config) },
  { when: config => config.darwin, flag: "-d" },
  { when: config => config.unix && config.release, flag: "-u" },
  { when: config => config.host?.os === "linux", flag: config => "-host=" + config.host.os + "," + config.host.arch },
];
const applied = (config: Config): string[] => flags.filter(flag => !flag.when || flag.when(config)).map(flag => (typeof flag.flag === "function" ? flag.flag(config) : flag.flag));
console.log(applied(standIn()).join(" "));
console.log(applied(standIn(darwin)).join(" "));
console.log(applied(small).join(" "));
console.log(applied(whole).join(" "));
for (const config of [standIn({ release: false }), standIn(darwin), whole]) console.log(uses(config), applied(config).join(" "));
console.log(standIn().os, standIn().version, small.host);
console.log(Object.keys(standIn({ os: "darwin" })).join(), JSON.stringify(small), JSON.stringify(whole));
