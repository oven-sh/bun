// Async functions, an async generator read with `for await`, a callback API wrapped into promises, and four lanes that share one index under Promise.all.
function delay(value) {
  return new Promise(function (resolve) {
    resolve(value);
  });
}

function promisify(fn) {
  return function () {
    var args = Array.prototype.slice.call(arguments);
    var self = this;
    return new Promise(function (resolve, reject) {
      args.push(function (error, value) {
        if (error) reject(error);
        else resolve(value);
      });
      fn.apply(self, args);
    });
  };
}

function readRecord(id, callback) {
  if (id % 17 === 0) callback(new Error("missing " + id));
  else callback(null, { id: id, size: (id * 7) % 13 });
}

var readRecordAsync = promisify(readRecord);

async function load(id) {
  try {
    var record = await readRecordAsync(id);
    return record.size;
  } catch (error) {
    return error.message.length;
  }
}

async function* batches(count, size) {
  for (var start = 0; start < count; start += size) {
    var ids = [];
    for (var id = start; id < start + size && id < count; id++) ids.push(id);
    yield await delay(ids);
  }
}

async function mapLimit(items, limit, worker) {
  var results = new Array(items.length);
  var next = 0;
  async function lane() {
    while (next < items.length) {
      var index = next++;
      results[index] = await worker(items[index]);
    }
  }
  var lanes = [];
  for (var i = 0; i < limit; i++) lanes.push(lane());
  await Promise.all(lanes);
  return results;
}

async function run(count) {
  var total = 0;
  for await (var ids of batches(count, 25)) {
    var sizes = await mapLimit(ids, 4, load);
    total += sizes.reduce(function (sum, size) {
      return sum + size;
    }, 0);
    total += (await Promise.all([delay(1), delay(2), 3])).length;
  }
  return total;
}

run(200000).then(function (total) {
  console.log(total);
});
