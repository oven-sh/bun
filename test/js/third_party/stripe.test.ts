import { bunExe } from "bun:harness";
import { expect, it } from "bun:test";
import { bunEnv, isBunCI, tmpdirSync } from "harness";
import * as path from "node:path";

it.skipIf(!isBunCI && !process.env.TEST_INFO_STRIPE)("should be able to query a charge", async () => {
  const package_dir = tmpdirSync("bun-test-");

  await Bun.write(
    path.join(package_dir, "package.json"),
    JSON.stringify({
      "dependencies": {
        "stripe": "^15.4.0",
      },
    }),
  );

  let { exited } = Bun.spawn({
    cmd: [bunExe(), "install"],
    stdout: "inherit",
    cwd: package_dir,
    stdin: "ignore",
    stderr: "inherit",
    env: bunEnv,
  });
  expect(await exited).toBe(0);

  // prettier-ignore
  const [access_token, charge_id, account_id] = process.env.TEST_INFO_STRIPE?.split(",");

  const fixture_path = path.join(package_dir, "index.js");
  await Bun.write(
    fixture_path,
    `
    const Stripe = require("stripe");
    const stripe = Stripe("${access_token}");

    await stripe.charges
      .retrieve("${charge_id}", {
        stripeAccount: "${account_id}",
      })
      .then((x) => {
        console.log(x);
      });
    `,
  );
  let stdout, stderr;

  ({ stdout, stderr, exited } = Bun.spawn({
    cmd: [bunExe(), "run", fixture_path],
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    cwd: package_dir,
    env: bunEnv,
  }));
  let out = await new Response(stdout).text();
  expect(out).toBeEmpty();
  let err = await new Response(stderr).text();
  expect(err).toContain(`error: No such charge: '${charge_id}'\n`);

  expect(await exited).toBe(1);
});
