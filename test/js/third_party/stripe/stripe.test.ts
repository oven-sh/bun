import { describe, expect, test } from "bun:test";
import { getSecret } from "harness";
import { Stripe } from "stripe";

const stripeCredentials = getSecret("TEST_INFO_STRIPE");

describe.skipIf(!stripeCredentials)("stripe", () => {
  const [accessToken, chargeId, accountId] = stripeCredentials!.split(",") ?? [];
  const stripe = new Stripe(accessToken);

  test("should be able to query a charge", async () => {
    expect(stripe.charges.retrieve(chargeId, { stripeAccount: accountId })).rejects.toThrow(
      `No such charge: '${chargeId}'`,
    );
  });
});
