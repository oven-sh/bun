
class Yo {
  @foo("hello")
  async plop() {}

  @anotherDecoratorWithALongName("and a very long string as a first argument")
  async plip() {}

  @anotherDecoratorWithALongName("another very long string, but now inline") async plip() {}
}
