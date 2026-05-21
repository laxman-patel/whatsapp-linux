export const SCHEMA_VERSION = 2

export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS chats (
    jid TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    is_group INTEGER NOT NULL DEFAULT 0,
    last_message TEXT,
    last_message_time INTEGER,
    unread_count INTEGER NOT NULL DEFAULT 0,
    participant_count INTEGER,
    avatar_path TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS contacts (
    jid TEXT PRIMARY KEY,
    name TEXT,
    push_name TEXT,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_jid TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    text TEXT,
    timestamp INTEGER NOT NULL,
    status TEXT,
    is_from_me INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (chat_jid) REFERENCES chats(jid)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(chat_jid, timestamp)`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
]
