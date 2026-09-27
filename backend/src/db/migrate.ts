import fs from "node:fs";
import path from "node:path";
import { ensureDatabase, pool } from "./client";

export async function migrate(): Promise<void> {
  await ensureDatabase();
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const conn = await pool.getConnection();
  try {
    for (const stmt of statements) {
      try {
        await conn.query(stmt);
      } catch (err) {
        const msg = String((err as Error)?.message ?? err);
        if (/Duplicate column|Duplicate key|Duplicate index|Duplicate entry|Unknown column|Unknown table|Can't DROP/i.test(msg)) {
          // skip silently
        } else {
          throw err;
        }
      }
    }
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log("[db] migrate ok");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[db] migrate failed:", err);
      process.exit(1);
    });
}
