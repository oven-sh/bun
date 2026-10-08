
type A = {
  new(...args): T<{
    A
  }
  >
};


type A1 = {
  (...args): T<{
    A
  }
  >
};

type A2 = {
  bar(
    ...args
  ): T<{
    A
  }>
}

class A3 {
  constructor(
    public eventName: string,
    data?: object,
  ) { }
}

class A4 {
  publicLog<
    E extends ClassifiedEvent<OmitMetadata<T>>,
    T extends IGDPRProperty,
  >(
    eventName: string, data?: object
  ) {
  }
}

const A5 = {
  publicLog<
    E extends ClassifiedEvent<OmitMetadata<T>>,
    T extends IGDPRProperty,
  >(
    eventName: string,
    data?: object,
  ) { }
}
