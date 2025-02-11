export function whatDidIPass(expr, ctx) {
  return ctx;
}

export function promiseReturningFunction(expr, ctx) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve(1);
    }, 1);
  });
}

export function promiseReturningCtx(expr, ctx) {
  return new Promise((resolve, reject) => {
    setTimeout(
      ctx => {
        resolve(ctx);
      },
      1,
      ctx,
    );
  });
}
