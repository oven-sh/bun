import { getSecret } from "harness";
import { expect, test, describe } from "bun:test";
import { Stripe } from "stripe";

const stripeCredentials = getSecret("TEST_INFO_STRIPE");

describe.skipIf(!stripeCredentials)("stripe", () => {
  const [accessToken, chargeId, accountId] = process.env.TEST_INFO_STRIPE?.split(",") ?? [];
  const stripe = new Stripe(accessToken);

  test("should be able to query a charge", async () => {
    expect(stripe.charges.retrieve(chargeId, { stripeAccount: accountId })).rejects.toThrow(
      `No such charge: '${chargeId}'`,
    );
  });
});
