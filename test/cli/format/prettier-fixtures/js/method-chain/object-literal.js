of("test")
  .pipe(throwIfEmpty())
  .subscribe({
    error(err) {
      thrown = err;
    }
  });

of("test")
  .pipe(throwIfEmpty())
  .subscribe({
    get foo() {
      bar();
    }
  });
