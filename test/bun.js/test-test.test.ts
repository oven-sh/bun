import { expect, test } from "bun:test";

test("toHaveProperty()", () => {
  const houseForSale = {
    bath: true,
    bedrooms: 4,
    kitchen: {
      amenities: ["oven", "stove", "washer"],
      area: 20,
      wallColor: "white",
      "nice.oven": true,
    },
    livingroom: {
      amenities: [
        {
          couch: [
            ["large", { dimensions: [20, 20] }],
            ["small", { dimensions: [10, 10] }],
          ],
        },
      ],
    },
    sunroom: "yes",
    "ceiling.height": 20,
    "no.nono": { nooooooo: "no" },
  };

  expect(houseForSale).toHaveProperty("bath");
  expect(houseForSale).not.toHaveProperty("jacuzzi");
  // expect(houseForSale).toHaveProperty("jacuzzi");
  // expect(houseForSale).not.toHaveProperty("bath");

  expect(houseForSale).toHaveProperty("bath", true);
  expect(houseForSale).not.toHaveProperty("bath", false);
  // expect(houseForSale).toHaveProperty("bath", false);
  // expect(houseForSale).not.toHaveProperty("bath", true);

  expect(houseForSale).toHaveProperty("bedrooms", 4);
  expect(houseForSale).toHaveProperty(["sunroom"], "yes");

  expect(houseForSale).toHaveProperty("kitchen.area", 20);
  expect(houseForSale).toHaveProperty("kitchen.amenities", [
    "oven",
    "stove",
    "washer",
  ]);

  expect(houseForSale).not.toHaveProperty(["kitchen", "area"], 21);
  expect(houseForSale).toHaveProperty(["kitchen", "area"], 20);
  expect(houseForSale).not.toHaveProperty(["kitchen", "area"], 29);
  expect(houseForSale).toHaveProperty(
    ["kitchen", "amenities"],
    ["oven", "stove", "washer"],
  );
  expect(houseForSale).toHaveProperty("kitchen.amenities[2]", "washer");
  expect(houseForSale).toHaveProperty(["kitchen", "amenities", 1], "stove");
  expect(houseForSale).toHaveProperty(["kitchen", "amenities", 0], "oven");
  expect(houseForSale).toHaveProperty(
    "livingroom.amenities[0].couch[0][1].dimensions[0]",
    20,
  );
  expect(houseForSale).toHaveProperty(["kitchen", "nice.oven"]);
  expect(houseForSale).not.toHaveProperty(["kitchen", "open"]);

  expect(houseForSale).toHaveProperty(["ceiling.height"], 20);

  expect({ a: { b: 1 } }).toHaveProperty("a.b");
  expect({ a: [2, 3, 4] }).toHaveProperty("a.0");
  expect({ a: [2, 3, 4] }).toHaveProperty("a.1");
  expect({ a: [2, 3, 4] }).toHaveProperty("a.2");

  expect({ a: [2, 3, 4] }).toHaveProperty("a[1]");
  expect([2, 3, 4]).toHaveProperty("1");
  expect([2, 3, 4]).toHaveProperty("[1]");
  expect([2, [6, 9], 4]).toHaveProperty("1.1");
  expect([2, [6, 9], 4]).toHaveProperty("1[1]");
  expect([2, [6, 9], 4]).toHaveProperty("[1].1");
  expect([2, [6, 9], 4]).toHaveProperty("[1][1]");
  expect([2, [6, 9], 4]).toHaveProperty([0], 2);

  expect({ a: { b: 1 } }).toHaveProperty("a.b");
  expect({ a: [1, 2, [3, { b: 1 }]] }).toHaveProperty("a.2.1.b");
  expect({ a: [1, 2, [3, { b: 1 }]] }).toHaveProperty("a");
  expect({ a: [1, 2, [3, { b: 1 }]] }).toHaveProperty("a[2][1].b");
  expect({ a: [1, 2, [3, { b: 1 }]] }).toHaveProperty("a[2][1]");
  expect({ a: [1, 2, [3, { b: 1 }]] }).not.toHaveProperty("a[2][1].c");

  expect("test").toHaveProperty("length");
  expect({}).toHaveProperty("constructor");
  expect({}).toHaveProperty("constructor.name");
  expect({}).toHaveProperty("constructor.name", "Object");

  expect(new Date()).toHaveProperty("getTime");
});

test("toBe()", () => {
  expect(1).toBe(1);
  // expect(1).not.toBe(1);

  expect(1).not.toBe(2);
  expect(1).not.toBe("1");
  expect("hello test").toBe("hello test");
  expect("hello test").not.toBe("hello test2");
});

test("toContain()", () => {
  expect("test").toContain("es");
  expect("test").toContain("est");
  expect("test").toContain("test");
  expect(["test", "es"]).toContain("es");
  expect("").toContain("");
  // expect([4, 5, 6]).not.toContain(5);

  expect([]).not.toContain([]);
});

test("toBeTruthy()", () => {
  expect("test").toBeTruthy();
  expect(true).toBeTruthy();
  expect(1).toBeTruthy();
  expect({}).toBeTruthy();
  expect([]).toBeTruthy();
  expect(() => {}).toBeTruthy();
  // expect(() => {}).not.toBeTruthy();

  expect("").not.toBeTruthy();
  expect(0).not.toBeTruthy();
  expect(-0).not.toBeTruthy();
  expect(NaN).not.toBeTruthy();
  expect(0n).not.toBeTruthy();
  expect(false).not.toBeTruthy();
  expect(null).not.toBeTruthy();
  expect(undefined).not.toBeTruthy();
});

test("toBeUndefined()", () => {
  expect(undefined).toBeUndefined();
  // expect(undefined).not.toBeUndefined();

  expect(null).not.toBeUndefined();
  expect(null).not.not.not.toBeUndefined();
  expect(0).not.toBeUndefined();
  expect("hello defined").not.toBeUndefined();
});

test("toBeNaN()", () => {
  expect(NaN).toBeNaN();
  // expect(NaN).not.toBeNaN();

  expect(0).not.toBeNaN();
  expect("hello not NaN").not.toBeNaN();
});

test("toBeNull()", () => {
  expect(null).toBeNull();
  // expect(null).not.toBeNull();

  expect(undefined).not.toBeNull();
  expect(0).not.toBeNull();
  expect("hello not null").not.toBeNull();
});

test("toBeDefined()", () => {
  expect(0).toBeDefined();
  expect("hello defined").toBeDefined();
  expect(null).toBeDefined();
  // expect(null).not.toBeDefined();

  expect(undefined).not.toBeDefined();
});

test("toBeFalsy()", () => {
  expect("").toBeFalsy();
  expect(0).toBeFalsy();
  expect(-0).toBeFalsy();
  expect(NaN).toBeFalsy();
  expect(0n).toBeFalsy();
  expect(false).toBeFalsy();
  expect(null).toBeFalsy();
  expect(undefined).toBeFalsy();
  // expect(undefined).not.toBeFalsy();

  expect("hello not falsy").not.toBeFalsy();
  expect("hello not falsy").not.not.not.toBeFalsy();
  expect(1).not.toBeFalsy();
  expect(true).not.toBeFalsy();
  expect({}).not.toBeFalsy();
  expect([]).not.toBeFalsy();
  expect(() => {}).not.toBeFalsy();
});
