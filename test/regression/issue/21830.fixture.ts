async function withUser(): Promise<string> {
  return "abc";
}
async function clearDatabase(): Promise<void> {
  return;
}
async function initTest(): Promise<void> {
  return;
}
async function bulkCreateShows(count: number, agent: string): Promise<void> {
  return;
}

describe("Create Show Tests", () => {
  let agent: Awaited<ReturnType<typeof withUser>>;
  beforeEach(async () => {
    await initTest(); //prepares an initial database
    agent = await withUser();
    console.log("Create Show Tests pre");
  });

  afterEach(async () => {
    await clearDatabase();
    console.log("Create Show Tests post");
  });

  // tests here...
  test("create show test", () => {});
});

describe("Get Show Data Tests", async () => {
  let agent: Awaited<ReturnType<typeof withUser>>;
  beforeEach(async () => {
    await initTest();
    agent = await withUser();
    await bulkCreateShows(10, agent);
    console.log("Get Show Data Tests pre");
  });

  afterEach(async () => {
    await clearDatabase();
    console.log("Get Show Data Tests post");
  });

  test("get show data tests", () => {});
});

describe("Show Deletion Tests", async () => {
  let agent: Awaited<ReturnType<typeof withUser>>;
  beforeAll(async () => {
    await initTest();
    agent = await withUser();
    await bulkCreateShows(10, agent);
    console.log("Show Deletion Tests pre ");
  });

  afterAll(async () => {
    console.log("Show Deletion test post ");
    await clearDatabase();
  });

  test("show deletion tests", () => {});
});
