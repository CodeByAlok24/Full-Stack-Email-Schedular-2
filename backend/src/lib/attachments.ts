import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const UPLOADS_DIR = path.resolve(__dirname, "..", "..", "uploads");

export interface StoredAttachment {
  name: string;
  size: number;
  type: string;
  file: string;
}

export interface ParsedAttachment {
  name: string;
  size: number;
  type: string;
  file?: string;
}

export function parseAttachments(raw: unknown): ParsedAttachment[] {
  if (raw == null) return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return [];
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (a): a is ParsedAttachment =>
      a != null &&
      typeof a === "object" &&
      typeof (a as { name?: unknown }).name === "string" &&
      (a as { name: string }).name.length > 0,
  );
}

function safeExt(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return /^\.[a-z0-9]{1,15}$/.test(ext) ? ext : "";
}

export async function saveAttachment(meta: {
  name: string;
  size: number;
  type: string;
  content: string;
}): Promise<StoredAttachment> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const file = `${randomUUID()}${safeExt(meta.name)}`;
  const buffer = Buffer.from(meta.content, "base64");
  if (buffer.length === 0) {
    throw new Error(`attachment "${meta.name}" decoded to empty content`);
  }
  await fs.writeFile(path.join(UPLOADS_DIR, file), buffer);
  return {
    name: path.basename(meta.name).slice(0, 255),
    size: buffer.length,
    type: meta.type || "application/octet-stream",
    file,
  };
}

export async function readAttachment(file: string): Promise<Buffer> {
  const safe = path.basename(file);
  return fs.readFile(path.join(UPLOADS_DIR, safe));
}
