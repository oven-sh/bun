fn main() {
    println!("cargo:rustc-link-search=native=/root/ref/build");
    println!("cargo:rustc-link-lib=static=webp_ref");
    println!("cargo:rustc-link-search=native={}/refc", std::env::var("CARGO_MANIFEST_DIR").unwrap());
    println!("cargo:rustc-link-lib=static=webp_refc");
    println!("cargo:rerun-if-changed=/root/ref/build/libwebp_ref.a");
}
