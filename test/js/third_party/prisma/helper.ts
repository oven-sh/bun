import fs from "fs";
import { bunEnv, bunExe, isLinux } from "harness";
import path from "path";
const cwd = import.meta.dir;

export async function generateClient(type: string, env: Record<string, string>) {
  generate(type, env);

  // This should run the first time on a fresh db
  try {
    migrate(type, env);
  } catch (err: any) {
    if (err.message.indexOf("Environment variable not found:") !== -1) throw err;
  }

  return (await import(`./prisma/${type}/client`)).PrismaClient;
}
export function migrate(type: string, env: Record<string, string>) {
  const result = Bun.spawnSync(
    [
      bunExe(),
      "x",
      "prisma",
      "migrate",
      "dev",
      "--name",
      "init",
      "--schema",
      path.join(cwd, "prisma", type, "schema.prisma"),
    ],
    {
      cwd,
      env: {
        ...bunEnv,
        NODE_ENV: undefined,
        ...env,
      },
    },
  );
  if (!result.success) throw new Error(result.stderr.toString("utf8"));
}

export function generate(type: string, env: Record<string, string>) {
  const schema = path.join(cwd, "prisma", type, "schema.prisma");

  const content = fs
    .readFileSync(schema)
    .toString("utf8")
    // only affect linux
    .replace(
      "%binaryTargets%",
      isLinux
        ? 'binaryTargets = ["native", "debian-openssl-1.1.x", "debian-openssl-3.0.x", "linux-musl", "linux-musl-openssl-3.0.x"]'
        : "",
    );

  fs.writeFileSync(schema, content);

  const result = Bun.spawnSync([bunExe(), "prisma", "generate", "--schema", schema], {
    cwd,
    env: {
      ...bunEnv,
      NODE_ENV: undefined,
      ...env,
    },
  });
  if (!result.success) throw new Error(result.stderr.toString("utf8"));
}
