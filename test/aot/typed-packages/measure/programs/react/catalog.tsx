import { createContext, memo, Suspense, useContext, useId, useMemo, type ReactNode } from "react";

interface Variant {
  id: string;
  color: string;
  inStock: boolean;
}

interface Product {
  id: number;
  name: string;
  brand: string;
  category: string;
  description: string;
  cents: number;
  discountPercent: number;
  rating: number;
  reviews: number;
  stock: number;
  tags: string[];
  variants: Variant[];
}

interface Shop {
  currency: string;
  locale: string;
  freeShippingFromCents: number;
}

interface Cart {
  quantities: Map<number, number>;
}

const ShopContext = createContext<Shop>({ currency: "$", locale: "en-US", freeShippingFromCents: 5000 });
const CartContext = createContext<Cart>({ quantities: new Map() });
const ThemeContext = createContext<"light" | "dark">("light");

const brands = ["Northwind", "Acme & Sons", "Fjord", "Kettle <Works>", "Lumen", "Harbor", "Ridge"];
const categories = ["Kitchen", "Outdoor", "Office", "Audio", "Lighting", "Travel"];
const colors = ["black", "white", "olive", "rust", "navy", "sand"];
const words = ["compact", "durable", "hand-finished", "lightweight", "insulated", "modular", "water-resistant", "rechargeable", "foldable", "quiet"];
const nouns = ["kettle", "lamp", "backpack", "speaker", "desk mat", "bottle", "notebook", "charger", "stool", "blanket"];

function stockOf(size: number): Product[] {
  let seed = 12345;
  const next = (below: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % below;
  };
  return Array.from({ length: size }, (_, id) => ({
    id,
    name: `${words[next(words.length)]} ${nouns[next(nouns.length)]} ${100 + next(900)}`,
    brand: brands[next(brands.length)],
    category: categories[next(categories.length)],
    description: `A ${words[next(words.length)]}, ${words[next(words.length)]} ${nouns[next(nouns.length)]} for "everyday" use & travel.`,
    cents: 499 + next(40000),
    discountPercent: next(4) === 0 ? 5 + next(40) : 0,
    rating: 20 + next(31),
    reviews: next(3000),
    stock: next(5) === 0 ? 0 : 1 + next(60),
    tags: Array.from({ length: next(4) }, () => words[next(words.length)]),
    variants: Array.from({ length: 1 + next(4) }, (_, index) => ({ id: `${id}-${index}`, color: colors[next(colors.length)], inStock: next(6) !== 0 })),
  }));
}

const products = stockOf(240);
const cart: Cart = { quantities: new Map(products.filter(product => product.id % 17 === 0).map(product => [product.id, 1 + (product.id % 3)])) };

function formatCents(currency: string, cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${currency}${whole}.${rest < 10 ? "0" : ""}${rest}`;
}

function Price({ cents, discountPercent }: { cents: number; discountPercent: number }) {
  const { currency, freeShippingFromCents } = useContext(ShopContext);
  const reduced = Math.round((cents * (100 - discountPercent)) / 100);
  return (
    <p className="price">
      {discountPercent > 0 ? (
        <>
          <s className="price-before">{formatCents(currency, cents)}</s> <strong className="price-now">{formatCents(currency, reduced)}</strong>
          <span className="price-saved">-{discountPercent}%</span>
        </>
      ) : (
        <strong className="price-now">{formatCents(currency, cents)}</strong>
      )}
      {reduced >= freeShippingFromCents && <small className="shipping">Free shipping</small>}
    </p>
  );
}

function Rating({ rating, reviews }: { rating: number; reviews: number }) {
  const stars = Math.round(rating / 10);
  return (
    <div className="rating" role="img" aria-label={`${(rating / 10).toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map(star => (
        <span key={star} className={star <= stars ? "star star-filled" : "star"} aria-hidden="true">
          {star <= stars ? "★" : "☆"}
        </span>
      ))}
      <a href="#reviews" className="reviews">
        {reviews === 0 ? "No reviews yet" : `${reviews} review${reviews === 1 ? "" : "s"}`}
      </a>
    </div>
  );
}

function Swatches({ variants, name }: { variants: Variant[]; name: string }) {
  const group = useId();
  return (
    <fieldset className="swatches">
      <legend className="hidden">Color of {name}</legend>
      {variants.map((variant, index) => (
        <label key={variant.id} className={variant.inStock ? "swatch" : "swatch swatch-gone"} style={{ backgroundColor: variant.color, borderWidth: 1 }}>
          <input type="radio" name={group} value={variant.id} defaultChecked={index === 0} disabled={!variant.inStock} />
          <span className="hidden">{variant.color}</span>
        </label>
      ))}
    </fieldset>
  );
}

function Badge({ children, kind }: { children: ReactNode; kind: "sale" | "low" | "gone" | "tag" }) {
  return <li className={`badge badge-${kind}`}>{children}</li>;
}

const ProductCard = memo(function ProductCard({ product, position }: { product: Product; position: number }) {
  const theme = useContext(ThemeContext);
  const { quantities } = useContext(CartContext);
  const inCart = quantities.get(product.id) ?? 0;
  const heading = useId();
  return (
    <article className={`card card-${theme}`} aria-labelledby={heading} data-product={product.id} data-position={position}>
      <a href={`/products/${product.id}`} className="card-image">
        <img src={`/images/${product.id}-400.webp`} srcSet={`/images/${product.id}-400.webp 1x, /images/${product.id}-800.webp 2x`} alt={product.name} width={400} height={300} loading={position < 8 ? "eager" : "lazy"} />
      </a>
      <ul className="badges">
        {product.discountPercent > 0 && <Badge kind="sale">Sale</Badge>}
        {product.stock === 0 ? <Badge kind="gone">Sold out</Badge> : product.stock < 5 ? <Badge kind="low">Only {product.stock} left</Badge> : null}
        {product.tags.map((tag, index) => (
          <Badge key={index} kind="tag">
            {tag}
          </Badge>
        ))}
      </ul>
      <h3 id={heading}>
        <a href={`/products/${product.id}`}>{product.name}</a>
      </h3>
      <p className="brand">
        by <a href={`/brands/${encodeURIComponent(product.brand)}`}>{product.brand}</a> in {product.category}
      </p>
      <p className="description">{product.description}</p>
      <Rating rating={product.rating} reviews={product.reviews} />
      <Price cents={product.cents} discountPercent={product.discountPercent} />
      {product.variants.length > 1 && <Swatches variants={product.variants} name={product.name} />}
      <form method="post" action="/cart">
        <input type="hidden" name="product" value={product.id} />
        <button type="submit" disabled={product.stock === 0} className={inCart > 0 ? "button button-again" : "button"}>
          {product.stock === 0 ? "Notify me" : inCart > 0 ? `Add another (${inCart} in cart)` : "Add to cart"}
        </button>
      </form>
    </article>
  );
});

function Filters({ all }: { all: Product[] }) {
  const counts = useMemo(() => {
    const perCategory = new Map<string, number>();
    for (const product of all) perCategory.set(product.category, (perCategory.get(product.category) ?? 0) + 1);
    return [...perCategory].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [all]);
  return (
    <aside className="filters">
      <h2>Filter</h2>
      <form method="get">
        {counts.map(([category, count]) => (
          <label key={category} className="filter">
            <input type="checkbox" name="category" value={category} defaultChecked={category === "Kitchen"} /> {category} <span className="count">({count})</span>
          </label>
        ))}
        <label>
          Sort by{" "}
          <select name="sort" defaultValue="rating">
            <option value="price">Price</option>
            <option value="rating">Rating</option>
            <option value="new">Newest</option>
          </select>
        </label>
      </form>
    </aside>
  );
}

function Header() {
  const { quantities } = useContext(CartContext);
  let items = 0;
  for (const quantity of quantities.values()) items += quantity;
  return (
    <header className="header">
      <a href="/" className="logo">
        Shop
      </a>
      <nav aria-label="Main">
        <ul>
          {categories.map(category => (
            <li key={category}>
              <a href={`/c/${category.toLowerCase()}`} aria-current={category === "Kitchen" ? "page" : undefined}>
                {category}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <a href="/cart" className="cart">
        Cart{items > 0 && <span className="cart-count">{items}</span>}
      </a>
    </header>
  );
}

export function Catalog() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Kitchen | Shop</title>
        <link rel="stylesheet" href="/shop.css" />
      </head>
      <body>
        <ShopContext value={{ currency: "$", locale: "en-US", freeShippingFromCents: 7500 }}>
          <CartContext value={cart}>
            <ThemeContext value="dark">
              <Header />
              <main>
                <Filters all={products} />
                <Suspense fallback={<p>Loading</p>}>
                  <section className="grid" aria-label={`${products.length} products`}>
                    {products.map((product, position) => (
                      <ProductCard key={product.id} product={product} position={position} />
                    ))}
                  </section>
                </Suspense>
              </main>
              <footer>
                <p>
                  Prices include tax. <a href="/terms">Terms &amp; conditions</a>
                </p>
              </footer>
            </ThemeContext>
          </CartContext>
        </ShopContext>
      </body>
    </html>
  );
}
