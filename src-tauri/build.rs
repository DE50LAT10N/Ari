fn main() {
    println!("cargo::rustc-check-cfg=cfg(gigachat_embedded_certs)");

    tauri_build::build();

    let root = std::path::Path::new("certs/russian_trusted_root_ca.pem");
    let sub = std::path::Path::new("certs/russian_trusted_sub_ca.pem");
    if root.exists() && sub.exists() {
        println!("cargo:rustc-cfg=gigachat_embedded_certs");
    }
}
