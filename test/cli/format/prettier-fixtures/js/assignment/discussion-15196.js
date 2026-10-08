async function f() {
  const { section, rubric, authors, tags } = await utils.upsertCommonData(mainData);

  const loooooooooooooooooooooooooong1 = await looooooooooooooong.looooooooooooooong.loooooong;
  const loooooooooooooooooooooooooong2 = await looooooooooooooong.looooooooooooooong.loooooong();
  const loooooooooooooooooooooooooong3 = await looooooooooooooooooooooooooooooooooooooooooooog();
  const loooooooooooooooooooooooooong4 = !await looooooooooooooong.looooooooooooooong.loooooong;
  const loooooooooooooooooooooooooong5 = void !!await looooooooooooooong.looooooooooooooong.loooooong;

  const longlonglonglonglonglonglong1 = await new Promise((resolve, reject) => { setTimeout(() => { resolve('foo'); }, 300); })
  const longlonglonglonglonglonglong2 = await { then(onFulfilled, onRejected) { onFulfilled(1234567890) } };
}

function* g() {
  const { section, rubric, authors, tags } = yield utils.upsertCommonData(mainData);

  const loooooooooooooooooooooooooong1 = yield looooooooooooooong.looooooooooooooong.loooooong;
  const loooooooooooooooooooooooooong2 = yield looooooooooooooong.looooooooooooooong.loooooong();
  const loooooooooooooooooooooooooong3 = yield looooooooooooooooooooooooooooooooooooooooooooog();
  const loooooooooooooooooooooooooong4 = !(yield looooooooooooooong.looooooooooooooong.loooooong);
  const loooooooooooooooooooooooooong5 = void !!(yield looooooooooooooong.looooooooooooooong.loooooong);
  const loooooooooooooooooooooooooong6 = yield* looooooooooooooong.looooooooooooooong.loooooong;

  const longlonglonglonglonglonglong1 = yield qwertyuiop(asdfghjkl, zxcvbnm, qwertyuiop, asdfghjkl);
  const longlonglonglonglonglonglong2 = yield { qwertyuiop: 1234567890, asdfghjkl: 1234567890, zxcvbnm: 123456789 };

  const x = yield;
}
