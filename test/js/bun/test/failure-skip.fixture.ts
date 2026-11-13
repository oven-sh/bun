const failurePoints = new Set(process.env.FAILURE_POINTS?.split(",") ?? []);

// FAILURE_VIA=done: a hook or test reports its failure through its done callback, not with a throw.
const viaDone = process.env.FAILURE_VIA === "done";

function hit(msg: string) {
  console.log(`%%<${msg}>%%`);
  if (failurePoints.has(msg)) throw new Error("failure in " + msg);
}

function step(msg: string) {
  if (!viaDone) return () => hit(msg);
  return (done: (err?: unknown) => void) => {
    console.log(`%%<${msg}>%%`);
    done(failurePoints.has(msg) ? new Error("failure in " + msg) : undefined);
  };
}

beforeAll(step("beforeall1"));
beforeAll(step("beforeall2"));
beforeEach(step("beforeeach1"));
beforeEach(step("beforeeach2"));

afterAll(step("afterall1"));
afterAll(step("afterall2"));
afterEach(step("aftereach1"));
afterEach(step("aftereach2"));

test("test", step("test1"));
test("test1", step("test2"));
