const failurePoints = new Set(process.env.FAILURE_POINTS?.split(",") ?? []);

function hit(msg: string) {
  console.log(`%%<${msg}>%%`);
  if (failurePoints.has(msg)) throw new Error("failure in " + msg);
}

beforeAll(() => hit("beforeall1"));
beforeAll(() => hit("beforeall2"));
beforeEach(() => hit("beforeeach1"));
beforeEach(() => hit("beforeeach2"));

afterAll(() => hit("afterall1"));
afterAll(() => hit("afterall2"));
afterEach(() => hit("aftereach1"));
afterEach(() => hit("aftereach2"));

test("test", () => hit("test1"));
test("test1", () => hit("test2"));
