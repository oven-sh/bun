class Card {
  rank = 5;
  suit = "hearts";
}

const card = new Card();
const view: { rank?: number } = card;
delete view.rank;
console.log(Object.keys(card).join());
console.log("rank" in card);
console.log(typeof card.rank);
console.log(card.rank + 1);
console.log(JSON.stringify(card));
view.rank = 9;
console.log(Object.keys(card).join());
console.log(card.rank + 1);

export {};
