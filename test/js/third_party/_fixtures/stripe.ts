const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_ACCESS_TOKEN);

await stripe.charges
  .retrieve(process.env.STRIPE_CHARGE_ID, { stripeAccount: process.env.STRIPE_ACCOUNT_ID })
  .then(x => {
    console.log(x);
  });
