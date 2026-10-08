class Foo {
  realTierLabel$ = this.billingPlansFacade.realTierLabel$.pipe(filterNullable());
}

const realTierLabel$ = this.billingPlansFacade.realTierLabel$.pipe(filterNullable());
