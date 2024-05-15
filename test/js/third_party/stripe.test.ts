import { bunExe } from "bun:harness";
import { bunEnv, runBunInstall, tmpdirSync } from "harness";
import * as path from "node:path";
import { expect, it } from "bun:test";

it.skipIf(!process.env.TEST_INFO_STRIPE)("should be able to query a charge", async () => {
  const package_dir = tmpdirSync("bun-test-");

  await Bun.write(path.join(package_dir, "package.json"), `{ "dependencies": { "stripe": "15.4.0" } }`);
  await runBunInstall(bunEnv, package_dir);

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

  let { stdout, stderr } = Bun.spawn({
    cmd: [bunExe(), "run", fixture_path],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });
  let out = await new Response(stdout).text();
  expect(out).toBeEmpty();
  let err = await new Response(stderr).text();
  expect(err).toContain(`error: No such charge: '${charge_id}'\n`);
});
