
this.firebase.object(`/shops/${shopLocation.shop}`)
  // keep distance info
  .first((shop: ShopQueryResult, index: number, source: Observable<ShopQueryResult>): any => {
      // add distance to result
      const s = shop;
      s.distance = shopLocation.distance;
      return s;
  });
