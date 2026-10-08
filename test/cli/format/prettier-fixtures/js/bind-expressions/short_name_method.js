class X {
  constructor() {
    this.shortMethod = ::this.shortMethod;
  }
  
  shortMethod() {
    return true;
  }
}