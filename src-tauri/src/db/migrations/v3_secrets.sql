-- Schema v3: in-DB secret storage.
-- Replaces OS keychain for OAuth tokens + ICS URLs. The DB file is
-- already in the OS app-data dir, readable only by the local user, so
-- the security posture for a single-user desktop app is effectively
-- identical for our threat model. Avoids the unsigned-dev-binary
-- keychain-ACL issue.

CREATE TABLE IF NOT EXISTS secret_store (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
