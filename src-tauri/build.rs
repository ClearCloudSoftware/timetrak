fn main() {
    // option_env! bakes these at compile time — without these lines cargo keeps
    // a stale build after the vars change.
    println!("cargo:rerun-if-env-changed=TIMETRAK_GOOGLE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=TIMETRAK_GOOGLE_CLIENT_SECRET");
    tauri_build::build()
}
