package main

import (
	"encoding/json"
	"expvar"
	"fmt"
	"net"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

type Profile struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	Email     string  `json:"email"`
	Age       int64   `json:"age"`
	Active    bool    `json:"active"`
	Score     float64 `json:"score"`
	Role      string  `json:"role"`
	City      string  `json:"city"`
	CreatedAt string  `json:"createdAt"`
	Visits    int64   `json:"visits"`
}

type CatalogItem struct {
	ID         int64  `json:"id"`
	Title      string `json:"title"`
	PriceCents int64  `json:"priceCents"`
	InStock    bool   `json:"inStock"`
}

type Catalog struct {
	Profile Profile       `json:"profile"`
	Items   []CatalogItem `json:"items"`
}

type PostPage struct {
	UserID int64  `json:"userId"`
	PostID string `json:"postId"`
	Page   int64  `json:"page"`
	Limit  int64  `json:"limit"`
	Sort   string `json:"sort"`
}

type Customer struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

type Item struct {
	SKU       string `json:"sku"`
	Quantity  int64  `json:"quantity"`
	UnitCents *int64 `json:"unitCents"`
}

type Order struct {
	Customer *Customer `json:"customer"`
	Items    []Item    `json:"items"`
	Coupon   string    `json:"coupon"`
}

type Line struct {
	SKU       string `json:"sku"`
	LineCents int64  `json:"lineCents"`
}

type Receipt struct {
	Shop          string `json:"shop"`
	CustomerID    int64  `json:"customerId"`
	Lines         []Line `json:"lines"`
	SubtotalCents int64  `json:"subtotalCents"`
	DiscountCents int64  `json:"discountCents"`
	TaxCents      int64  `json:"taxCents"`
	TotalCents    int64  `json:"totalCents"`
}

type Summary struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Orders     int    `json:"orders"`
	TotalCents int64  `json:"totalCents"`
}

type UserRow struct {
	ID           int64
	Name         string
	Email        string
	Age          int64
	Active       bool
	Score        float64
	Role         string
	City         string
	CreatedAt    string
	Visits       int64
	PasswordHash string
}

type ProductRow struct {
	ID         int64
	Title      string
	PriceCents int64
	Stock      int64
}

type OrderRow struct {
	ID         int64
	UserID     int64
	TotalCents int64
}

var (
	cities       = []string{"Lisbon", "Osaka", "Denver", "Nairobi", "Oslo"}
	users        = map[int64]*UserRow{}
	products     []ProductRow
	ordersByUser = map[int64][]OrderRow{}
	email        = regexp.MustCompile(`^[^@\s]+@[^@\s]+$`)
)

func seed() {
	for id := int64(1); id <= 100; id++ {
		role := "member"
		if id%10 == 0 {
			role = "admin"
		}
		users[id] = &UserRow{
			ID:           id,
			Name:         fmt.Sprintf("User %d", id),
			Email:        fmt.Sprintf("user%d@example.com", id),
			Age:          20 + id%50,
			Active:       id%2 == 0,
			Score:        float64(id) + 0.5,
			Role:         role,
			City:         cities[id%int64(len(cities))],
			CreatedAt:    fmt.Sprintf("2026-01-%02dT00:00:00.000Z", 1+id%28),
			Visits:       id * 37,
			PasswordHash: fmt.Sprintf("hash-%d", id),
		}
		for n := int64(0); n < 5; n++ {
			ordersByUser[id] = append(ordersByUser[id], OrderRow{ID: id*10 + n, UserID: id, TotalCents: 1000 + n*250 + id})
		}
	}
	for id := int64(1); id <= 50; id++ {
		products = append(products, ProductRow{ID: id, Title: fmt.Sprintf("Product %d", id), PriceCents: 199 + id*350, Stock: id % 7})
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	body, err := json.Marshal(value)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(body)
}

func text(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte("Hello, World!"))
}

func catalog(w http.ResponseWriter, r *http.Request) {
	user, ok := users[42]
	if !ok {
		http.NotFound(w, r)
		return
	}
	result := Catalog{
		Profile: Profile{
			ID:        user.ID,
			Name:      user.Name,
			Email:     user.Email,
			Age:       user.Age,
			Active:    user.Active,
			Score:     user.Score,
			Role:      user.Role,
			City:      user.City,
			CreatedAt: user.CreatedAt,
			Visits:    user.Visits,
		},
		Items: make([]CatalogItem, 0, len(products)),
	}
	for _, product := range products {
		result.Items = append(result.Items, CatalogItem{ID: product.ID, Title: product.Title, PriceCents: product.PriceCents, InStock: product.Stock > 0})
	}
	writeJSON(w, http.StatusOK, result)
}

func positive(text string, fallback int64) int64 {
	value, err := strconv.ParseInt(text, 10, 64)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func postPage(w http.ResponseWriter, r *http.Request) {
	userID, err := strconv.ParseInt(r.PathValue("userId"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	query := r.URL.Query()
	sort := query.Get("sort")
	if sort == "" {
		sort = "new"
	}
	writeJSON(w, http.StatusOK, PostPage{
		UserID: userID,
		PostID: r.PathValue("postId"),
		Page:   positive(query.Get("page"), 1),
		Limit:  min(positive(query.Get("limit"), 20), 100),
		Sort:   sort,
	})
}

func between(s string, least, most int) bool {
	n := utf8.RuneCountInString(s)
	return n >= least && n <= most
}

func (o *Order) valid() bool {
	c := o.Customer
	if c == nil || c.ID < 1 || !between(c.Name, 1, 100) || !email.MatchString(c.Email) {
		return false
	}
	if len(o.Items) < 1 || len(o.Items) > 100 || !between(o.Coupon, 0, 16) {
		return false
	}
	for i := range o.Items {
		item := &o.Items[i]
		if !between(item.SKU, 1, 32) || item.Quantity < 1 || item.Quantity > 1000 || item.UnitCents == nil || *item.UnitCents < 0 {
			return false
		}
	}
	return true
}

func invalid(w http.ResponseWriter) {
	writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid order"})
}

func orders(w http.ResponseWriter, r *http.Request) {
	shop := r.PathValue("shop")
	if !between(shop, 1, 32) {
		invalid(w)
		return
	}
	var order Order
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&order); err != nil || !order.valid() {
		invalid(w)
		return
	}
	receipt := Receipt{Shop: shop, CustomerID: order.Customer.ID, Lines: make([]Line, 0, len(order.Items))}
	for _, item := range order.Items {
		cents := item.Quantity * *item.UnitCents
		receipt.Lines = append(receipt.Lines, Line{SKU: item.SKU, LineCents: cents})
		receipt.SubtotalCents += cents
	}
	if order.Coupon == "TENOFF" {
		receipt.DiscountCents = receipt.SubtotalCents / 10
	}
	receipt.TaxCents = (receipt.SubtotalCents - receipt.DiscountCents) * 8 / 100
	receipt.TotalCents = receipt.SubtotalCents - receipt.DiscountCents + receipt.TaxCents
	writeJSON(w, http.StatusOK, receipt)
}

func findUser(id int64) (*UserRow, error) {
	user, ok := users[id]
	if !ok {
		return nil, fmt.Errorf("no user %d", id)
	}
	return user, nil
}

func findOrders(userID int64) ([]OrderRow, error) {
	return ordersByUser[userID], nil
}

func sumOrders(orders []OrderRow) (int64, error) {
	var totalCents int64
	for _, order := range orders {
		totalCents += order.TotalCents
	}
	return totalCents, nil
}

func summarize(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	user, err := findUser(id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	orders, err := findOrders(user.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	totalCents, err := sumOrders(orders)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, Summary{ID: user.ID, Name: user.Name, Orders: len(orders), TotalCents: totalCents})
}

func findProducts(offset, limit int) []ProductRow {
	return products[offset:min(offset+limit, len(products))]
}

func exportProducts(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/csv")
	flusher, _ := w.(http.Flusher)
	for offset := 0; offset < len(products); offset += 5 {
		var chunk strings.Builder
		for _, product := range findProducts(offset, 5) {
			fmt.Fprintf(&chunk, "%d,%s,%d\n", product.ID, product.Title, product.PriceCents)
		}
		w.Write([]byte(chunk.String()))
		if flusher != nil {
			flusher.Flush()
		}
	}
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	seed()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /text", text)
	mux.HandleFunc("GET /json", catalog)
	mux.HandleFunc("GET /users/{userId}/posts/{postId}", postPage)
	mux.HandleFunc("POST /shops/{shop}/orders", orders)
	mux.HandleFunc("POST /shops/{shop}/checked-orders", orders)
	mux.HandleFunc("POST /shops/{shop}/typed-orders", orders)
	mux.HandleFunc("GET /async/{id}", summarize)
	mux.HandleFunc("GET /stream", exportProducts)
	mux.Handle("GET /debug/vars", expvar.Handler())
	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("listening", listener.Addr().(*net.TCPAddr).Port)
	if err := http.Serve(listener, mux); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
