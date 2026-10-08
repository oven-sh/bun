type Foo =
  (ThingamabobberFactory extends AbstractThingamabobberFactory ? GobbledygookProvider : CompositeGobbledygookProvider) extends
  DoubleGobbledygookProvider
    ? UniqueDalgametreService
    : CompositeZamazingoResolver;

type Foo2 =
  DoubleGobbledygookProvider extends
  (ThingamabobberFactory extends AbstractThingamabobberFactory ? GobbledygookProvider : CompositeGobbledygookProvider)
    ? UniqueDalgametreService
    : CompositeZamazingoResolver;

type Foo3 =
  (ThingamabobberFactory extends AbstractThingamabobberFactory ? GobbledygookProvider : CompositeGobbledygookProvider) extends
  (DoubleGobbledygookProvider extends MockGobbledygookProvider ? MockThingamabobberFactory : ThingamabobberFactory)
    ? UniqueDalgametreService
    : CompositeZamazingoResolver;
