import { Hono } from "hono";

type Variables = {
  message: string;
};

const app = new Hono<{ Variables: Variables }>();

app.use(async (c, next) => {
  c.set("message", "Hono is cool!");
  await next();
});

app.get("/", c => {
  const message = c.get("message");
  return c.text(`The message is "${message}"`);
});

export default app;
