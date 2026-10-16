import express from "express";

const app = express();
app.disable("x-powered-by");
app.set("json spaces", 1);

app.use((req, res, next) => {
  req.visitor = req.get("x-user") ?? "nobody";
  res.set("x-first", req.method);
  next();
});

const things = express.Router({ mergeParams: true });
things.param("id", (req, res, next, id) => {
  if (!/^\d+$/.test(id)) return next(Object.assign(new Error(`${id} is no number`), { status: 400 }));
  req.thing = { id: Number(id) };
  next();
});
things.get("/:id", (req, res) => res.json({ ...req.thing, scope: req.params.version }));
things
  .route("/")
  .get((req, res) => res.json([]))
  .post(express.json(), (req, res) => res.status(201).json({ made: req.body }));
app.use("/:version/things", things);

app.get("/who", (req, res) => res.json({ by: req.visitor, host: typeof req.hostname, secure: req.secure, path: req.path }));
app.get("/moved", (req, res) => res.redirect(301, "/who"));
app.get("/nothing-to-say", (req, res) => res.sendStatus(204));
app.get("/visits", (req, res) => {
  res.cookie("visits", "1", { httpOnly: true, maxAge: 60_000, sameSite: "lax" });
  res.json({ cookie: req.get("cookie") ?? null });
});
app.get("/either", (req, res) => {
  res.format({
    "text/plain": () => res.send("plain"),
    "application/json": () => res.json({ kind: "json" }),
    default: () => res.status(406).send("neither"),
  });
});
app.get("/queries", (req, res) => res.json(req.query));
app.get(/^\/files\/([a-z]+)\.txt$/, (req, res) => res.type("text/plain").send(req.params[0]));
app.get("/rest/*rest", (req, res) => res.json(req.params.rest));
app.get("/optional{/:kind}", (req, res) => res.json({ kind: req.params.kind ?? null }));
app.post("/form", express.urlencoded({ extended: true }), (req, res) => res.json(req.body));
app.post("/text", express.text(), (req, res) => res.send(String(req.body).toUpperCase()));
app.all("/any", (req, res) => res.send(req.method));
app.get("/throws", () => {
  throw new RangeError("out of range");
});
app.get("/rejects", async () => {
  throw Object.assign(new Error("short and stout"), { status: 418 });
});
app.get(
  "/chain",
  (req, res, next) => {
    res.locals.steps = ["first"];
    next();
  },
  (req, res, next) => {
    res.locals.steps.push("second");
    next("route");
  },
  (req, res) => res.send("never"),
);
app.get("/chain", (req, res) => res.json(res.locals.steps));

app.use((req, res) => res.status(404).json({ missing: req.originalUrl, by: req.visitor }));
app.use((error, req, res, next) => {
  res.status(error.status ?? 500).json({ handled: error.name, message: error.message });
});

const server = app.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () => {
  console.log("listening", server.address().port);
});
