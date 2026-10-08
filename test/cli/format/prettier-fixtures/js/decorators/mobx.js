import {observable} from "mobx";

@observer class OrderLine {
  @observable price = 0;
  @observable amount = 1;

  constructor(price) {
    this.price = price;
  }

  @computed get total() {
    return this.price * this.amount;
  }

  @action.bound setPrice(price) {
    this.price = price;
  }

  @computed
  get total() {
    return this.price * this.amount;
  }

  @action.bound
  setPrice(price) {
    this.price = price;
  }

  @computed @computed @computed @computed @computed @computed @computed get total() {
    return this.price * this.amount;
  }

  @action handleDecrease = (event) => this.count--;

  @action handleSomething = (event) => doSomething();
}
