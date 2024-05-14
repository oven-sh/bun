import { bunExe } from "bun:harness";
import { bunEnv, tmpdirSync } from "harness";
import * as path from "node:path";
import { createTest } from "node-harness";
const { describe, expect, it, beforeAll, afterAll, createDoneDotAll } = createTest(import.meta.path);

it.skipIf(!process.env.TEST_INFO_STRIPE)("should be able to query a charge", async () => {
  const package_dir = tmpdirSync();

  await Bun.write(
    path.join(package_dir, "package.json"),
    JSON.stringify({
      "dependencies": {
        "stripe": "^15.4.0",
      },
    }),
  );

  let { stdout, stderr } = Bun.spawn({
    cmd: [bunExe(), "install"],
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });
  let err = await new Response(stderr).text();
  expect(err).not.toContain("panic:");
  expect(err).not.toContain("error:");
  expect(err).not.toContain("warn:");
  let out = await new Response(stdout).text();

  // prettier-ignore
  const [access_token, charge_id, account_id] = process.env.TEST_INFO_STRIPE?.split(",");

  const fixture_path = path.join(package_dir, "index.js");
  await Bun.write(
    fixture_path,
    String.raw`
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

  ({ stdout, stderr } = Bun.spawn({
    cmd: [bunExe(), "run", fixture_path],
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  }));
  out = await new Response(stdout).text();
  expect(out).toBeEmpty();
  err = await new Response(stderr).text();
  expect(err).toContain(`error: No such charge: '${charge_id}'\n`);
});
