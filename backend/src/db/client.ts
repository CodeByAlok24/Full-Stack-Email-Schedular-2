import mysql from "mysql2/promise";
import { env } from "../config/env";
import { parseAttachments, type StoredAttachment } from "../lib/attachments";

export async function ensureDatabase(): Promise<void> {
  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
  });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await conn.end();
  }
}

export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: "Z",
});

pool.on("connection", (connection) => {
  (connection as unknown as { query: (sql: string, cb?: (err: Error | null) => void) => void }).query(
    "SET time_zone = '+00:00'",
    (err) => {
      if (err) console.error("[db] failed to set session time_zone to UTC:", err);
    },
  );
});

export type EmailStatus = "pending" | "scheduled" | "processing" | "sent" | "failed";

export interface EmailRow {
  id: string;
  user_id: string | null;
  recipient: string;
  subject: string;
  body: string;
  sender: string;
  from_name: string | null;
  send_at: Date;
  sent_at: Date | null;
  status: EmailStatus;
  attempts: number;
  last_error: string | null;
  preview_url?: string | null;
  attachments: unknown;
  created_at: Date;
  updated_at: Date;
}

export interface EmailDto {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  sender: string;
  fromName?: string;
  sendAt: string;
  sentAt: string | null;
  status: EmailStatus;
  createdAt: string;
  updatedAt: string;
  previewUrl?: string | null;
  attachments?: { name: string; size: number; type: string }[];
}

function toIso(d: Date | null): string | null {
  return d ? new Date(d).toISOString() : null;
}

export function toEmailDto(row: EmailRow): EmailDto {
  const stored = parseAttachments(row.attachments) as StoredAttachment[];
  const attachments = stored.length
    ? stored.map(({ name, size, type }) => ({ name, size, type }))
    : undefined;
  return {
    id: row.id,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    sender: row.sender,
    ...(row.from_name ? { fromName: row.from_name } : {}),
    sendAt: toIso(row.send_at) ?? "",
    sentAt: toIso(row.sent_at),
    status: row.status,
    createdAt: toIso(row.created_at) ?? "",
    updatedAt: toIso(row.updated_at) ?? "",
    ...(row.preview_url ? { previewUrl: row.preview_url } : {}),
    ...(attachments ? { attachments } : {}),
  };
}

export function toMySQLDate(d: Date): string {
  return d.toISOString().slice(0, 23).replace("T", " ");
}
