import { describe, expect, test } from "bun:test";
import { getSecret } from "harness";
import { Stripe } from "stripe";

const stripeCredentials = getSecret("TEST_INFO_STRIPE");

describe.skipIf(!stripeCredentials)("stripe", () => {
  const [accessToken, chargeId, accountId] = process.env.TEST_INFO_STRIPE?.split(",") ?? [];

  test("should be able to query a charge", async () => {
    // Stripe 23 throws from the constructor when there is no key, so the client is made where the test runs.
    const stripe = new Stripe(accessToken);
    await expect(stripe.charges.retrieve(chargeId, {}, { stripeAccount: accountId })).rejects.toThrow(
      `No such charge: '${chargeId}'`,
    );
  });
});
