// Running this file in jest/vitest does not work as expected. Jest & Vitest
// mess with timers, producing unreliable results. You must manually test this
// in Node.
import { expect, it } from "bun:test";
const isBun = !!process.versions.bun;

it("process.nextTick", async () => {
  // You can verify this test is correct by copy pasting this into a browser's console and checking it doesn't throw an error.
  var run = 0;
  var queueMicrotask = process.nextTick;

  await new Promise((resolve, reject) => {
    queueMicrotask(() => {
      if (run++ != 0) {
        reject(new Error("Microtask execution order is wrong: " + run));
      }
      queueMicrotask(() => {
        if (run++ != 3) {
          reject(new Error("Microtask execution order is wrong: " + run));
        }
      });
    });
    queueMicrotask(() => {
      if (run++ != 1) {
        reject(new Error("Microtask execution order is wrong: " + run));
      }
      queueMicrotask(() => {
        if (run++ != 4) {
          reject(new Error("Microtask execution order is wrong: " + run));
        }

        queueMicrotask(() => {
          if (run++ != 6) {
            reject(new Error("Microtask execution order is wrong: " + run));
          }
        });
      });
    });
    queueMicrotask(() => {
      if (run++ != 2) {
        reject(new Error("Microtask execution order is wrong: " + run));
      }
      queueMicrotask(() => {
        if (run++ != 5) {
          reject(new Error("Microtask execution order is wrong: " + run));
        }

        queueMicrotask(() => {
          if (run++ != 7) {
            reject(new Error("Microtask execution order is wrong: " + run));
          }
          resolve(true);
        });
      });
    });
  });

  {
    let passed = false;
    try {
      queueMicrotask(1234);
    } catch (exception) {
      if (isBun) {
        passed = exception instanceof TypeError;
      } else {
        // Node.js throws a non-TypeError TypeError
        passed = exception instanceof Error && exception.name === "TypeError";
      }
    }

    if (!passed) throw new Error("1: queueMicrotask should throw a TypeError if the argument is not a function");
  }

  {
    let passed = false;
    try {
      queueMicrotask();
    } catch (exception) {
      if (isBun) {
        passed = exception instanceof TypeError;
      } else {
        // Node.js throws a non-TypeError TypeError
        passed = exception instanceof Error && exception.name === "TypeError";
      }
    }

    if (!passed) throw new Error("2: queueMicrotask should throw a TypeError if the argument is empty");
  }
});

it("process.nextTick 2 args", async () => {
  await new Promise((resolve, reject) => {
    process.nextTick(
      (first, second) => {
        if (first !== 12345 || second !== "hello") reject(new Error("process.nextTick called with wrong arguments"));
        resolve(true);
      },
      12345,
      "hello",
    );
  });
});

it("process.nextTick 5 args", async () => {
  await new Promise((resolve, reject) => {
    var args = [12345, "hello", "hello", "hello", 5];
    process.nextTick(
      (...receivedArgs) => {
        if (!args.every((arg, index) => arg === receivedArgs[index]))
          reject(new Error("process.nextTick called with wrong arguments"));
        resolve(true);
      },
      ...args,
    );
  });
});

it("process.nextTick runs after queueMicrotask", async () => {
  var resolve;
  var promise = new Promise(_resolve => {
    resolve = _resolve;
  });

  const order = [];
  var nextTickI = 0;
  var microtaskI = 0;
  var remaining = 400;
  var runs = [];
  for (let i = 0; i < 100; i++) {
    queueMicrotask(() => {
      runs.push(queueMicrotask.name);
      order.push("queueMicrotask " + microtaskI++);
      if (--remaining === 0) resolve(order);
    });
    process.nextTick(() => {
      runs.push(process.nextTick.name);
      order.push("process.nextTick " + nextTickI++);
      if (--remaining === 0) resolve(order);
    });
  }

  for (let i = 0; i < 100; i++) {
    queueMicrotask(() => {
      runs.push(queueMicrotask.name);
      order.push("queueMicrotask " + microtaskI++);
      if (--remaining === 0) resolve(order);
    });
  }

  for (let i = 0; i < 100; i++) {
    process.nextTick(() => {
      runs.push(process.nextTick.name);
      order.push("process.nextTick " + nextTickI++);
      if (--remaining === 0) resolve(order);
    });
  }

  await promise;
  expect({
    order,
    runs,
  }).toEqual({
    "order": [
      "process.nextTick 0",
      "process.nextTick 1",
      "process.nextTick 2",
      "process.nextTick 3",
      "process.nextTick 4",
      "process.nextTick 5",
      "process.nextTick 6",
      "process.nextTick 7",
      "process.nextTick 8",
      "process.nextTick 9",
      "process.nextTick 10",
      "process.nextTick 11",
      "process.nextTick 12",
      "process.nextTick 13",
      "process.nextTick 14",
      "process.nextTick 15",
      "process.nextTick 16",
      "process.nextTick 17",
      "process.nextTick 18",
      "process.nextTick 19",
      "process.nextTick 20",
      "process.nextTick 21",
      "process.nextTick 22",
      "process.nextTick 23",
      "process.nextTick 24",
      "process.nextTick 25",
      "process.nextTick 26",
      "process.nextTick 27",
      "process.nextTick 28",
      "process.nextTick 29",
      "process.nextTick 30",
      "process.nextTick 31",
      "process.nextTick 32",
      "process.nextTick 33",
      "process.nextTick 34",
      "process.nextTick 35",
      "process.nextTick 36",
      "process.nextTick 37",
      "process.nextTick 38",
      "process.nextTick 39",
      "process.nextTick 40",
      "process.nextTick 41",
      "process.nextTick 42",
      "process.nextTick 43",
      "process.nextTick 44",
      "process.nextTick 45",
      "process.nextTick 46",
      "process.nextTick 47",
      "process.nextTick 48",
      "process.nextTick 49",
      "process.nextTick 50",
      "process.nextTick 51",
      "process.nextTick 52",
      "process.nextTick 53",
      "process.nextTick 54",
      "process.nextTick 55",
      "process.nextTick 56",
      "process.nextTick 57",
      "process.nextTick 58",
      "process.nextTick 59",
      "process.nextTick 60",
      "process.nextTick 61",
      "process.nextTick 62",
      "process.nextTick 63",
      "process.nextTick 64",
      "process.nextTick 65",
      "process.nextTick 66",
      "process.nextTick 67",
      "process.nextTick 68",
      "process.nextTick 69",
      "process.nextTick 70",
      "process.nextTick 71",
      "process.nextTick 72",
      "process.nextTick 73",
      "process.nextTick 74",
      "process.nextTick 75",
      "process.nextTick 76",
      "process.nextTick 77",
      "process.nextTick 78",
      "process.nextTick 79",
      "process.nextTick 80",
      "process.nextTick 81",
      "process.nextTick 82",
      "process.nextTick 83",
      "process.nextTick 84",
      "process.nextTick 85",
      "process.nextTick 86",
      "process.nextTick 87",
      "process.nextTick 88",
      "process.nextTick 89",
      "process.nextTick 90",
      "process.nextTick 91",
      "process.nextTick 92",
      "process.nextTick 93",
      "process.nextTick 94",
      "process.nextTick 95",
      "process.nextTick 96",
      "process.nextTick 97",
      "process.nextTick 98",
      "process.nextTick 99",
      "process.nextTick 100",
      "process.nextTick 101",
      "process.nextTick 102",
      "process.nextTick 103",
      "process.nextTick 104",
      "process.nextTick 105",
      "process.nextTick 106",
      "process.nextTick 107",
      "process.nextTick 108",
      "process.nextTick 109",
      "process.nextTick 110",
      "process.nextTick 111",
      "process.nextTick 112",
      "process.nextTick 113",
      "process.nextTick 114",
      "process.nextTick 115",
      "process.nextTick 116",
      "process.nextTick 117",
      "process.nextTick 118",
      "process.nextTick 119",
      "process.nextTick 120",
      "process.nextTick 121",
      "process.nextTick 122",
      "process.nextTick 123",
      "process.nextTick 124",
      "process.nextTick 125",
      "process.nextTick 126",
      "process.nextTick 127",
      "process.nextTick 128",
      "process.nextTick 129",
      "process.nextTick 130",
      "process.nextTick 131",
      "process.nextTick 132",
      "process.nextTick 133",
      "process.nextTick 134",
      "process.nextTick 135",
      "process.nextTick 136",
      "process.nextTick 137",
      "process.nextTick 138",
      "process.nextTick 139",
      "process.nextTick 140",
      "process.nextTick 141",
      "process.nextTick 142",
      "process.nextTick 143",
      "process.nextTick 144",
      "process.nextTick 145",
      "process.nextTick 146",
      "process.nextTick 147",
      "process.nextTick 148",
      "process.nextTick 149",
      "process.nextTick 150",
      "process.nextTick 151",
      "process.nextTick 152",
      "process.nextTick 153",
      "process.nextTick 154",
      "process.nextTick 155",
      "process.nextTick 156",
      "process.nextTick 157",
      "process.nextTick 158",
      "process.nextTick 159",
      "process.nextTick 160",
      "process.nextTick 161",
      "process.nextTick 162",
      "process.nextTick 163",
      "process.nextTick 164",
      "process.nextTick 165",
      "process.nextTick 166",
      "process.nextTick 167",
      "process.nextTick 168",
      "process.nextTick 169",
      "process.nextTick 170",
      "process.nextTick 171",
      "process.nextTick 172",
      "process.nextTick 173",
      "process.nextTick 174",
      "process.nextTick 175",
      "process.nextTick 176",
      "process.nextTick 177",
      "process.nextTick 178",
      "process.nextTick 179",
      "process.nextTick 180",
      "process.nextTick 181",
      "process.nextTick 182",
      "process.nextTick 183",
      "process.nextTick 184",
      "process.nextTick 185",
      "process.nextTick 186",
      "process.nextTick 187",
      "process.nextTick 188",
      "process.nextTick 189",
      "process.nextTick 190",
      "process.nextTick 191",
      "process.nextTick 192",
      "process.nextTick 193",
      "process.nextTick 194",
      "process.nextTick 195",
      "process.nextTick 196",
      "process.nextTick 197",
      "process.nextTick 198",
      "process.nextTick 199",
      "queueMicrotask 0",
      "queueMicrotask 1",
      "queueMicrotask 2",
      "queueMicrotask 3",
      "queueMicrotask 4",
      "queueMicrotask 5",
      "queueMicrotask 6",
      "queueMicrotask 7",
      "queueMicrotask 8",
      "queueMicrotask 9",
      "queueMicrotask 10",
      "queueMicrotask 11",
      "queueMicrotask 12",
      "queueMicrotask 13",
      "queueMicrotask 14",
      "queueMicrotask 15",
      "queueMicrotask 16",
      "queueMicrotask 17",
      "queueMicrotask 18",
      "queueMicrotask 19",
      "queueMicrotask 20",
      "queueMicrotask 21",
      "queueMicrotask 22",
      "queueMicrotask 23",
      "queueMicrotask 24",
      "queueMicrotask 25",
      "queueMicrotask 26",
      "queueMicrotask 27",
      "queueMicrotask 28",
      "queueMicrotask 29",
      "queueMicrotask 30",
      "queueMicrotask 31",
      "queueMicrotask 32",
      "queueMicrotask 33",
      "queueMicrotask 34",
      "queueMicrotask 35",
      "queueMicrotask 36",
      "queueMicrotask 37",
      "queueMicrotask 38",
      "queueMicrotask 39",
      "queueMicrotask 40",
      "queueMicrotask 41",
      "queueMicrotask 42",
      "queueMicrotask 43",
      "queueMicrotask 44",
      "queueMicrotask 45",
      "queueMicrotask 46",
      "queueMicrotask 47",
      "queueMicrotask 48",
      "queueMicrotask 49",
      "queueMicrotask 50",
      "queueMicrotask 51",
      "queueMicrotask 52",
      "queueMicrotask 53",
      "queueMicrotask 54",
      "queueMicrotask 55",
      "queueMicrotask 56",
      "queueMicrotask 57",
      "queueMicrotask 58",
      "queueMicrotask 59",
      "queueMicrotask 60",
      "queueMicrotask 61",
      "queueMicrotask 62",
      "queueMicrotask 63",
      "queueMicrotask 64",
      "queueMicrotask 65",
      "queueMicrotask 66",
      "queueMicrotask 67",
      "queueMicrotask 68",
      "queueMicrotask 69",
      "queueMicrotask 70",
      "queueMicrotask 71",
      "queueMicrotask 72",
      "queueMicrotask 73",
      "queueMicrotask 74",
      "queueMicrotask 75",
      "queueMicrotask 76",
      "queueMicrotask 77",
      "queueMicrotask 78",
      "queueMicrotask 79",
      "queueMicrotask 80",
      "queueMicrotask 81",
      "queueMicrotask 82",
      "queueMicrotask 83",
      "queueMicrotask 84",
      "queueMicrotask 85",
      "queueMicrotask 86",
      "queueMicrotask 87",
      "queueMicrotask 88",
      "queueMicrotask 89",
      "queueMicrotask 90",
      "queueMicrotask 91",
      "queueMicrotask 92",
      "queueMicrotask 93",
      "queueMicrotask 94",
      "queueMicrotask 95",
      "queueMicrotask 96",
      "queueMicrotask 97",
      "queueMicrotask 98",
      "queueMicrotask 99",
      "queueMicrotask 100",
      "queueMicrotask 101",
      "queueMicrotask 102",
      "queueMicrotask 103",
      "queueMicrotask 104",
      "queueMicrotask 105",
      "queueMicrotask 106",
      "queueMicrotask 107",
      "queueMicrotask 108",
      "queueMicrotask 109",
      "queueMicrotask 110",
      "queueMicrotask 111",
      "queueMicrotask 112",
      "queueMicrotask 113",
      "queueMicrotask 114",
      "queueMicrotask 115",
      "queueMicrotask 116",
      "queueMicrotask 117",
      "queueMicrotask 118",
      "queueMicrotask 119",
      "queueMicrotask 120",
      "queueMicrotask 121",
      "queueMicrotask 122",
      "queueMicrotask 123",
      "queueMicrotask 124",
      "queueMicrotask 125",
      "queueMicrotask 126",
      "queueMicrotask 127",
      "queueMicrotask 128",
      "queueMicrotask 129",
      "queueMicrotask 130",
      "queueMicrotask 131",
      "queueMicrotask 132",
      "queueMicrotask 133",
      "queueMicrotask 134",
      "queueMicrotask 135",
      "queueMicrotask 136",
      "queueMicrotask 137",
      "queueMicrotask 138",
      "queueMicrotask 139",
      "queueMicrotask 140",
      "queueMicrotask 141",
      "queueMicrotask 142",
      "queueMicrotask 143",
      "queueMicrotask 144",
      "queueMicrotask 145",
      "queueMicrotask 146",
      "queueMicrotask 147",
      "queueMicrotask 148",
      "queueMicrotask 149",
      "queueMicrotask 150",
      "queueMicrotask 151",
      "queueMicrotask 152",
      "queueMicrotask 153",
      "queueMicrotask 154",
      "queueMicrotask 155",
      "queueMicrotask 156",
      "queueMicrotask 157",
      "queueMicrotask 158",
      "queueMicrotask 159",
      "queueMicrotask 160",
      "queueMicrotask 161",
      "queueMicrotask 162",
      "queueMicrotask 163",
      "queueMicrotask 164",
      "queueMicrotask 165",
      "queueMicrotask 166",
      "queueMicrotask 167",
      "queueMicrotask 168",
      "queueMicrotask 169",
      "queueMicrotask 170",
      "queueMicrotask 171",
      "queueMicrotask 172",
      "queueMicrotask 173",
      "queueMicrotask 174",
      "queueMicrotask 175",
      "queueMicrotask 176",
      "queueMicrotask 177",
      "queueMicrotask 178",
      "queueMicrotask 179",
      "queueMicrotask 180",
      "queueMicrotask 181",
      "queueMicrotask 182",
      "queueMicrotask 183",
      "queueMicrotask 184",
      "queueMicrotask 185",
      "queueMicrotask 186",
      "queueMicrotask 187",
      "queueMicrotask 188",
      "queueMicrotask 189",
      "queueMicrotask 190",
      "queueMicrotask 191",
      "queueMicrotask 192",
      "queueMicrotask 193",
      "queueMicrotask 194",
      "queueMicrotask 195",
      "queueMicrotask 196",
      "queueMicrotask 197",
      "queueMicrotask 198",
      "queueMicrotask 199",
    ],
    "runs": [
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "nextTick",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
      "queueMicrotask",
    ],
  });
});

it("process.nextTick can be called 100,000 times", async () => {
  var county = 0;
  function ticky() {
    county++;
  }
  for (let i = 0; i < 100_000; i++) {
    process.nextTick(ticky);
  }

  await 1;
  expect(county).toBe(100_000);
});

it("process.nextTick works more than once", async () => {
  var county = 0;
  function ticky() {
    county++;
  }
  for (let i = 0; i < 1000; i++) {
    process.nextTick(ticky);
    await 1;
  }
  expect(county).toBe(1);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(county).toBe(1000);
});

// `enterWith` is problematic because it and `nextTick` both rely on
// JSC's `global.onEachMicrotaskTick`, and this test is designed to
// cover what happens when both are active
it("process.nextTick and AsyncLocalStorage.enterWith don't conflict", async () => {
  const AsyncLocalStorage = require("async_hooks").AsyncLocalStorage;
  const t = require("timers/promises");
  const storage = new AsyncLocalStorage();

  let call1 = false;
  let call2 = false;

  process.nextTick(() => (call1 = true));

  const p = Promise.withResolvers();
  const p2 = p.promise.then(() => {
    return storage.getStore(); // should not leak "hello"
  });
  const promise = Promise.resolve().then(async () => {
    storage.enterWith("hello");
    process.nextTick(() => (call2 = true));

    let didCall = false;
    let value = null;
    function ticky() {
      didCall = true;
      value = storage.getStore();
    }
    process.nextTick(ticky);
    await t.setTimeout(1);
    expect(didCall).toBe(true);
    expect(value).toBe("hello");
    expect(storage.getStore()).toBe("hello");
  });

  expect(storage.getStore()).toBe(undefined);
  await promise;
  p.resolve();
  expect(await p2).toBe(undefined);

  expect(call1).toBe(true);
  expect(call2).toBe(true);
});
