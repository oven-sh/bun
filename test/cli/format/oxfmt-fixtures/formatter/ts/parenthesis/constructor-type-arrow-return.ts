const f = (): (new () => Foo) => new Foo();

const g = (): new () => Foo => new Foo();

export const provideCloudMessagingServiceClass = (): (new () => CloudMessagingService) => {
  return MobileCloudMessagingService;
};

const h = (): (new <T>() => T) => new Foo();

const i = (): (abstract new () => Foo) => new Foo();

const j = (): (() => Foo) => () => new Foo();

type T = (new () => Foo) | Bar;
