export interface ShopQueryResult {
  chic: boolean;
  location: number[];
  menus: Menu[];
  openingDays: number[];
  closingDays: [
    {
      from: string,
      to: string,
    }, // <== this one
  ];
  shop: string;
  distance: number;
}
