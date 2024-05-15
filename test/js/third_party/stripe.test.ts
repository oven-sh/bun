import { bunExe } from "bun:harness";
import { bunEnv, runBunInstall, tmpdirSync } from "harness";
import * as path from "node:path";
import { expect, it } from "bun:test";

it.skipIf(!process.env.TEST_INFO_STRIPE)("should be able to query a charge", async () => {
  const [access_token, charge_id, account_id] = process.env.TEST_INFO_STRIPE?.split(",");

  let { stdout, stderr } = Bun.spawn({
    cmd: [bunExe(), "run", path.join(import.meta.dirname, "_fixtures", "stripe.ts")],
    cwd: import.meta.dirname,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: {
      ...bunEnv,
      STRIPE_ACCESS_TOKEN: access_token,
      STRIPE_CHARGE_ID: charge_id,
      STRIPE_ACCOUNT_ID: account_id,
    },
  });
  let out = await new Response(stdout).text();
  expect(out).toBeEmpty();
  let err = await new Response(stderr).text();
  expect(err).toContain(`error: No such charge: '${charge_id}'\n`);
});
