const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable. Set it in Render (or a local .env) to your Neon connection string.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('rider','consumer')),
      contact TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL
    );

    -- Driver-level availability + vehicle info, separate from any single ride listing.
    CREATE TABLE IF NOT EXISTS driver_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      vehicle_info TEXT DEFAULT '',
      is_available BOOLEAN NOT NULL DEFAULT false,
      updated_at BIGINT NOT NULL
    );

    -- Rider-posted fixed listings (existing behavior).
    CREATE TABLE IF NOT EXISTS rides (
      id TEXT PRIMARY KEY,
      rider_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rider_name TEXT NOT NULL,
      from_place TEXT NOT NULL,
      to_place TEXT NOT NULL,
      ride_date TEXT,
      ride_time TEXT,
      seats INTEGER NOT NULL DEFAULT 1,
      note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      created_at BIGINT NOT NULL
    );

    -- Consumer-submitted "anywhere" ride requests: any available driver can accept.
    CREATE TABLE IF NOT EXISTS ride_requests (
      id TEXT PRIMARY KEY,
      consumer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      consumer_name TEXT NOT NULL,
      driver_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      from_place TEXT NOT NULL,
      to_place TEXT NOT NULL,
      note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled','completed')),
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      ride_id TEXT REFERENCES rides(id) ON DELETE CASCADE,
      ride_request_id TEXT REFERENCES ride_requests(id) ON DELETE CASCADE,
      rider_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      consumer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL
    );

    -- Messages now store AES-256-GCM ciphertext, never plain text.
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body_encrypted TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    -- Tracks the last time each participant opened/read a conversation, so
    -- we can compute unread counts and "seen" receipts without storing
    -- per-message read state.
    CREATE TABLE IF NOT EXISTS conversation_reads (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_at BIGINT NOT NULL,
      PRIMARY KEY (conversation_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
    CREATE INDEX IF NOT EXISTS idx_ride_requests_status ON ride_requests(status);
    CREATE INDEX IF NOT EXISTS idx_ride_requests_driver ON ride_requests(driver_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_rider ON conversations(rider_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_consumer ON conversations(consumer_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
  `);

  // Backfill: existing deployments may have a 'contact' column missing, or
  // conversations with no ride_request_id column yet (older schema). The
  // CREATE TABLE IF NOT EXISTS above won't add columns to an existing table,
  // so patch those in separately, safely, if they're missing.
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='users' AND column_name='contact'
      ) THEN
        ALTER TABLE users ADD COLUMN contact TEXT NOT NULL DEFAULT '';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='conversations' AND column_name='ride_request_id'
      ) THEN
        ALTER TABLE conversations ADD COLUMN ride_request_id TEXT REFERENCES ride_requests(id) ON DELETE CASCADE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='conversations' AND column_name='ride_id'
      ) THEN
        ALTER TABLE conversations ADD COLUMN ride_id TEXT REFERENCES rides(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);
}

module.exports = { pool, initSchema };
