// Simple migration runner
require('dotenv').config();
const { readFileSync } = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function migrate() {
  console.log('Running migrations...');
  const sql = readFileSync('./migrations/001_init.sql', 'utf8');

  try {
    await pool.query(sql);
    console.log('✓ Migrations applied successfully');
  } catch (err) {
    console.error('✗ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
