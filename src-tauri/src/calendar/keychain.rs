use keyring::Entry;

use crate::error::{AppError, AppResult};

const SERVICE: &str = "com.timetrak.app";

pub fn put(key: &str, value: &str) -> AppResult<()> {
    Entry::new(SERVICE, key)
        .and_then(|e| e.set_password(value))
        .map_err(|e| AppError::Other(format!("keychain put: {e}")))
}

pub fn get(key: &str) -> AppResult<Option<String>> {
    let entry = Entry::new(SERVICE, key)
        .map_err(|e| AppError::Other(format!("keychain entry: {e}")))?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Other(format!("keychain get: {e}"))),
    }
}

pub fn delete(key: &str) -> AppResult<()> {
    let entry = Entry::new(SERVICE, key)
        .map_err(|e| AppError::Other(format!("keychain entry: {e}")))?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Other(format!("keychain delete: {e}"))),
    }
}
