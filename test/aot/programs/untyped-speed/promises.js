// Promises in `then` and `catch` chains, under `await` with a rejection that is caught, ten at a time under Promise.all, and behind a callback.
function delayValue(value) {
  return new Promise(function (resolve) {
    resolve(value);
  });
}

function fetchRecord(id) {
  return delayValue({ id: id, size: id % 13 });
}

function chain(id) {
  return fetchRecord(id)
    .then(function (record) {
      return record.size + 1;
    })
    .then(function (size) {
      if (size === 5) throw new Error("five");
      return size * 2;
    })
    .catch(function (error) {
      return error.message.length;
    });
}

async function viaAwait(id) {
  var record = await fetchRecord(id);
  var extra = await record.size;
  try {
    if (extra === 7) await Promise.reject(new Error("seven"));
  } catch (error) {
    extra += error.message.length;
  }
  return record.id + extra;
}

async function batch(start, size) {
  var pending = [];
  for (var i = 0; i < size; i++) pending.push(i & 1 ? chain(start + i) : viaAwait(start + i));
  var results = await Promise.all(pending);
  var total = 0;
  for (var j = 0; j < results.length; j++) total += results[j];
  return total;
}

function callbackStyle(value, done) {
  Promise.resolve(value).then(function (result) {
    done(null, result + 1);
  });
}

async function run(rounds) {
  var total = 0;
  for (var i = 0; i < rounds; i++) {
    total += await batch(i * 10, 10);
    total += await new Promise(function (resolve) {
      callbackStyle(i & 3, function (error, result) {
        resolve(result);
      });
    });
  }
  return total;
}

run(40000).then(function (total) {
  console.log(total);
});
