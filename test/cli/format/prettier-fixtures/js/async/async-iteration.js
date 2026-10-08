
async function * a() {
    yield* b();
}

class X {
    async * b() {
        yield* a();
    }
}
