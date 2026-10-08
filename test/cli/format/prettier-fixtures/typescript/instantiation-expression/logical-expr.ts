export class Foo<T> {
  message: string;
}

function sample(error: unknown) {
  if (!(error instanceof Foo<'some-type'> || error instanceof Error) || !error.message) {
    return 'something';
  }
}
