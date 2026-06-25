const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_TYPE = process.env.DB_TYPE || 'sqlite';
let pgClient = null;
let sqliteDb = null;

// Initialize Database connection
async function init() {
  if (DB_TYPE === 'postgres') {
    const { Client } = require('pg');
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required for PostgreSQL mode.');
    }
    pgClient = new Client({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    await pgClient.connect();
    console.log('Successfully connected to PostgreSQL database.');
    await runMigrationsPostgres();
  } else {
    // SQLite
    const dbPath = path.resolve(process.env.SQLITE_DB_PATH || './database.sqlite');
    // Ensure directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    sqliteDb = new sqlite3.Database(dbPath);
    console.log(`Successfully connected to SQLite database at: ${dbPath}`);
    await runMigrationsSqlite();
  }
}

// SQLite Migration Script
function runMigrationsSqlite() {
  return new Promise((resolve, reject) => {
    sqliteDb.serialize(() => {
      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => { if (err) return reject(err); });

      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          status TEXT NOT NULL,
          media_source TEXT NOT NULL,
          media_url TEXT NOT NULL,
          summary TEXT,
          chapters TEXT,
          raw_transcript TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });
}

// PostgreSQL Migration Script
async function runMigrationsPostgres() {
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      media_source TEXT NOT NULL,
      media_url TEXT NOT NULL,
      summary TEXT,
      chapters TEXT,
      raw_transcript TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// Universal Query Runners
// Converts standard SQL using '?' to '$1, $2' if in PostgreSQL mode
function executeSql(sql, params = []) {
  let query = sql;
  const values = [...params];
  
  if (DB_TYPE === 'postgres') {
    let index = 1;
    query = sql.replace(/\?/g, () => `$${index++}`);
  }
  
  return { query, values };
}

function run(sql, params = []) {
  const { query, values } = executeSql(sql, params);
  
  if (DB_TYPE === 'postgres') {
    return pgClient.query(query, values);
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(query, values, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }
}

function get(sql, params = []) {
  const { query, values } = executeSql(sql, params);
  
  if (DB_TYPE === 'postgres') {
    return pgClient.query(query, values).then(res => res.rows[0] || null);
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(query, values, (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  }
}

function all(sql, params = []) {
  const { query, values } = executeSql(sql, params);
  
  if (DB_TYPE === 'postgres') {
    return pgClient.query(query, values).then(res => res.rows);
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.all(query, values, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }
}

module.exports = {
  init,
  run,
  get,
  all
};
