use std::{collections::HashMap, convert::Infallible, fmt::Write, sync::Arc};

use axum::{
    body::Body,
    extract::{rejection::JsonRejection, Path, Query, State},
    http::{header::CONTENT_TYPE, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Profile {
    id: i64,
    name: String,
    email: String,
    age: i64,
    active: bool,
    score: f64,
    role: String,
    city: String,
    created_at: String,
    visits: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogItem {
    id: i64,
    title: String,
    price_cents: i64,
    in_stock: bool,
}

#[derive(Serialize)]
struct Catalog {
    profile: Profile,
    items: Vec<CatalogItem>,
}

#[derive(Deserialize)]
struct PostQuery {
    page: Option<String>,
    limit: Option<String>,
    sort: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostPage {
    user_id: i64,
    post_id: String,
    page: i64,
    limit: i64,
    sort: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Customer {
    id: i64,
    name: String,
    email: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Item {
    sku: String,
    quantity: i64,
    unit_cents: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Order {
    customer: Customer,
    items: Vec<Item>,
    coupon: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Line {
    sku: String,
    line_cents: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    shop: String,
    customer_id: i64,
    lines: Vec<Line>,
    subtotal_cents: i64,
    discount_cents: i64,
    tax_cents: i64,
    total_cents: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Summary {
    id: i64,
    name: String,
    orders: usize,
    total_cents: i64,
}

#[derive(Serialize)]
struct Problem {
    error: &'static str,
}

#[allow(dead_code)]
struct UserRow {
    id: i64,
    name: String,
    email: String,
    age: i64,
    active: bool,
    score: f64,
    role: String,
    city: String,
    created_at: String,
    visits: i64,
    password_hash: String,
}

struct ProductRow {
    id: i64,
    title: String,
    price_cents: i64,
    stock: i64,
}

#[allow(dead_code)]
struct OrderRow {
    id: i64,
    user_id: i64,
    total_cents: i64,
}

struct Database {
    users: HashMap<i64, UserRow>,
    products: Vec<ProductRow>,
    orders_by_user: HashMap<i64, Vec<OrderRow>>,
}

impl Database {
    fn seed() -> Self {
        let cities = ["Lisbon", "Osaka", "Denver", "Nairobi", "Oslo"];
        let mut users = HashMap::new();
        let mut orders_by_user = HashMap::new();
        for id in 1..=100i64 {
            users.insert(
                id,
                UserRow {
                    id,
                    name: format!("User {id}"),
                    email: format!("user{id}@example.com"),
                    age: 20 + id % 50,
                    active: id % 2 == 0,
                    score: id as f64 + 0.5,
                    role: if id % 10 == 0 { "admin" } else { "member" }.to_string(),
                    city: cities[id as usize % cities.len()].to_string(),
                    created_at: format!("2026-01-{:02}T00:00:00.000Z", 1 + id % 28),
                    visits: id * 37,
                    password_hash: format!("hash-{id}"),
                },
            );
            orders_by_user.insert(id, (0..5).map(|n| OrderRow { id: id * 10 + n, user_id: id, total_cents: 1000 + n * 250 + id }).collect());
        }
        let products = (1..=50i64).map(|id| ProductRow { id, title: format!("Product {id}"), price_cents: 199 + id * 350, stock: id % 7 }).collect();
        Database { users, products, orders_by_user }
    }

    async fn find_user(&self, id: i64) -> Option<&UserRow> {
        self.users.get(&id)
    }

    async fn find_orders(&self, user_id: i64) -> &[OrderRow] {
        self.orders_by_user.get(&user_id).map(|orders| orders.as_slice()).unwrap_or(&[])
    }

    async fn sum_orders(&self, orders: &[OrderRow]) -> i64 {
        orders.iter().map(|order| order.total_cents).sum()
    }

    async fn find_products(&self, offset: usize, limit: usize) -> &[ProductRow] {
        &self.products[offset..(offset + limit).min(self.products.len())]
    }
}

async fn text() -> &'static str {
    "Hello, World!"
}

async fn catalog(State(db): State<Arc<Database>>) -> Response {
    let Some(user) = db.users.get(&42) else { return StatusCode::NOT_FOUND.into_response() };
    Json(Catalog {
        profile: Profile {
            id: user.id,
            name: user.name.clone(),
            email: user.email.clone(),
            age: user.age,
            active: user.active,
            score: user.score,
            role: user.role.clone(),
            city: user.city.clone(),
            created_at: user.created_at.clone(),
            visits: user.visits,
        },
        items: db
            .products
            .iter()
            .map(|product| CatalogItem { id: product.id, title: product.title.clone(), price_cents: product.price_cents, in_stock: product.stock > 0 })
            .collect(),
    })
    .into_response()
}

fn positive(text: Option<&str>, fallback: i64) -> i64 {
    text.and_then(|text| text.parse::<i64>().ok()).filter(|value| *value > 0).unwrap_or(fallback)
}

async fn post_page(Path((user_id, post_id)): Path<(i64, String)>, Query(query): Query<PostQuery>) -> Json<PostPage> {
    Json(PostPage {
        user_id,
        post_id,
        page: positive(query.page.as_deref(), 1),
        limit: positive(query.limit.as_deref(), 20).min(100),
        sort: query.sort.unwrap_or_else(|| "new".to_string()),
    })
}

fn between(s: &str, least: usize, most: usize) -> bool {
    let n = s.chars().count();
    n >= least && n <= most
}

fn is_email(text: &str) -> bool {
    match text.split_once('@') {
        Some((name, host)) => !name.is_empty() && !host.is_empty() && !host.contains('@') && !text.chars().any(char::is_whitespace),
        None => false,
    }
}

impl Order {
    fn valid(&self) -> bool {
        let c = &self.customer;
        c.id >= 1
            && between(&c.name, 1, 100)
            && is_email(&c.email)
            && (1..=100).contains(&self.items.len())
            && self.coupon.as_deref().is_none_or(|coupon| between(coupon, 0, 16))
            && self.items.iter().all(|item| between(&item.sku, 1, 32) && (1..=1000).contains(&item.quantity) && item.unit_cents >= 0)
    }
}

fn invalid() -> Response {
    (StatusCode::BAD_REQUEST, Json(Problem { error: "invalid order" })).into_response()
}

async fn orders(Path(shop): Path<String>, order: Result<Json<Order>, JsonRejection>) -> Response {
    let Ok(Json(order)) = order else { return invalid() };
    if !between(&shop, 1, 32) || !order.valid() {
        return invalid();
    }
    let lines: Vec<Line> = order.items.into_iter().map(|item| Line { line_cents: item.quantity * item.unit_cents, sku: item.sku }).collect();
    let subtotal_cents: i64 = lines.iter().map(|line| line.line_cents).sum();
    let discount_cents = if order.coupon.as_deref() == Some("TENOFF") { subtotal_cents / 10 } else { 0 };
    let tax_cents = (subtotal_cents - discount_cents) * 8 / 100;
    Json(Receipt { shop, customer_id: order.customer.id, lines, subtotal_cents, discount_cents, tax_cents, total_cents: subtotal_cents - discount_cents + tax_cents }).into_response()
}

async fn summarize(State(db): State<Arc<Database>>, Path(id): Path<i64>) -> Response {
    let Some(user) = db.find_user(id).await else { return StatusCode::NOT_FOUND.into_response() };
    let orders = db.find_orders(user.id).await;
    let total_cents = db.sum_orders(orders).await;
    Json(Summary { id: user.id, name: user.name.clone(), orders: orders.len(), total_cents }).into_response()
}

async fn export_products(State(db): State<Arc<Database>>) -> Response {
    let count = db.products.len();
    let chunks = stream::iter((0..count).step_by(5)).then(move |offset| {
        let db = db.clone();
        async move {
            let mut chunk = String::new();
            for product in db.find_products(offset, 5).await {
                writeln!(chunk, "{},{},{}", product.id, product.title, product.price_cents).unwrap();
            }
            Ok::<_, Infallible>(chunk)
        }
    });
    ([(CONTENT_TYPE, "text/csv")], Body::from_stream(chunks)).into_response()
}

fn main() {
    let one_thread = std::env::var("SERVER_THREADS").is_ok_and(|threads| threads == "1");
    let mut runtime = if one_thread { tokio::runtime::Builder::new_current_thread() } else { tokio::runtime::Builder::new_multi_thread() };
    runtime.enable_all().build().unwrap().block_on(serve());
}

async fn serve() {
    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let app = Router::new()
        .route("/text", get(text))
        .route("/json", get(catalog))
        .route("/users/{user_id}/posts/{post_id}", get(post_page))
        .route("/shops/{shop}/orders", post(orders))
        .route("/shops/{shop}/checked-orders", post(orders))
        .route("/shops/{shop}/typed-orders", post(orders))
        .route("/async/{id}", get(summarize))
        .route("/stream", get(export_products))
        .with_state(Arc::new(Database::seed()));
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await.unwrap();
    println!("listening {}", listener.local_addr().unwrap().port());
    axum::serve(listener, app).await.unwrap();
}
