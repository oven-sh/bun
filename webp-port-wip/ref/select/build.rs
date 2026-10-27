fn main() {
    println!("cargo:rustc-link-search=native=/root/ref/cov");
    println!("cargo:rustc-link-lib=static=webp_ref");
    println!("cargo:rerun-if-changed=/root/ref/cov/libwebp_ref.a");
}
