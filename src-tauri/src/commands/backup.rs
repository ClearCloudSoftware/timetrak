//! Backup ("VACUUM INTO" snapshot) and staged restore commands.

use rusqlite::Connection;
use tauri::{AppHandle, Manager, State};

use crate::db::{restore_pending_path, Database};
use crate::error::{AppError, AppResult};

pub fn backup_inner(conn: &Connection, dest: &str) -> AppResult<()> {
    // Write to a temp file next to `dest` and rename over it atomically, so a
    // failed VACUUM INTO (disk full, lock, permissions) never touches an
    // existing backup at `dest` — the rename is the only thing that can
    // clobber it, and it only runs once the new snapshot is fully written.
    let tmp = format!("{dest}.tmp");
    if std::path::Path::new(&tmp).exists() {
        std::fs::remove_file(&tmp)?;
    }
    conn.execute("VACUUM INTO ?1", [&tmp])?;
    std::fs::rename(&tmp, dest)?;
    Ok(())
}

/// A restorable file is a SQLite DB that passes integrity_check and carries
/// our schema_version marker.
pub fn validate_backup(src: &str) -> AppResult<()> {
    let conn = Connection::open_with_flags(
        src,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| AppError::Invalid(format!("not a SQLite database: {e}")))?;
    let ok: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| AppError::Invalid(format!("integrity check failed: {e}")))?;
    if ok != "ok" {
        return Err(AppError::Invalid("backup file failed integrity check".into()));
    }
    conn.query_row("SELECT value FROM app_meta WHERE key = 'schema_version'", [], |r| {
        r.get::<_, String>(0)
    })
    .map_err(|_| AppError::Invalid("not a TimeTrak backup (no schema_version)".into()))?;
    Ok(())
}

#[tauri::command]
pub fn backup_db(db: State<'_, Database>, dest: String) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    backup_inner(&conn, &dest)
}

#[tauri::command]
pub fn restore_db(app: AppHandle, src: String) -> AppResult<()> {
    validate_backup(&src)?;
    let live = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(e.to_string()))?
        .join("timetrak.sqlite");
    // Copy to a temp file next to the pending path and rename over it
    // atomically, so an interrupted copy never leaves a truncated pending
    // file for the next `Database::open` to swap in — only a harmless .tmp,
    // overwritten on the next restore attempt.
    let pending = restore_pending_path(&live);
    let mut tmp_name = pending.clone().into_os_string();
    tmp_name.push(".tmp");
    let tmp = std::path::PathBuf::from(tmp_name);
    std::fs::copy(&src, &tmp)?;
    std::fs::rename(&tmp, &pending)?;
    app.restart(); // never returns
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn backup_writes_openable_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("backup.sqlite");
        let db = fresh_db();
        {
            let conn = db.conn.lock().unwrap();
            backup_inner(&conn, dest.to_str().unwrap()).unwrap();
        }
        let out = rusqlite::Connection::open(&dest).unwrap();
        let cats: i64 = out.query_row("SELECT COUNT(*) FROM category", [], |r| r.get(0)).unwrap();
        assert_eq!(cats, 4);
    }

    #[test]
    fn backup_overwrites_existing_dest_via_rename_not_delete() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("backup.sqlite");
        std::fs::write(&dest, b"junk from a previous, unrelated file").unwrap();
        let db = fresh_db();
        {
            let conn = db.conn.lock().unwrap();
            backup_inner(&conn, dest.to_str().unwrap()).unwrap();
        }
        let out = rusqlite::Connection::open(&dest).unwrap();
        let cats: i64 = out.query_row("SELECT COUNT(*) FROM category", [], |r| r.get(0)).unwrap();
        assert_eq!(cats, 4);
        assert!(!std::path::Path::new(&format!("{}.tmp", dest.to_str().unwrap())).exists());
    }

    #[test]
    fn validate_rejects_non_timetrak_files() {
        let dir = tempfile::tempdir().unwrap();
        let junk = dir.path().join("junk.sqlite");
        std::fs::write(&junk, b"not a database").unwrap();
        assert!(validate_backup(junk.to_str().unwrap()).is_err());
    }
}
