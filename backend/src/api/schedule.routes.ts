import { randomUUID } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import type { RowDataPacket } from "mysql2/promise";
import { pool, toEmailDto, toMySQLDate, type EmailRow } from "../db/client";
import { enqueueEmail } from "../queue/queue";
import { sanitizeBody } from "../lib/sanitize";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth";
import { env } from "../config/env";
import { saveAttachment, readAttachment, parseAttachments, type StoredAttachment } from "../lib/attachments";
import { resolveDelayBetweenEmailsMs } from "../lib/sendDelay";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 1000;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const scheduleRouter = Router();
scheduleRouter.use(requireAuth);

scheduleRouter.post(
  "/schedule",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthedRequest).userId;
      const bodyObj = (req.body ?? {}) as Record<string, unknown>;
      const subject = bodyObj.subject;
      const body = bodyObj.body;
      const recipients = bodyObj.recipients;
      const sender = bodyObj.sender;
      const startAt = (bodyObj.scheduledAt as string) ?? (bodyObj.startAt as string);
      const delayMs = resolveDelayBetweenEmailsMs(bodyObj, env.minSendDelayMs);
      const hourlyLimit = bodyObj.hourlyLimit;
      const attachments = bodyObj.attachments;

      if (delayMs === null) {
        res.status(400).json({
          message: "delayBetweenEmails must be a non-negative number of seconds",
        });
        return;
      }

      if (!subject || typeof subject !== "string" || !subject.trim()) {
        res.status(400).json({ message: "subject is required" });
        return;
      }
      if (!body || typeof body !== "string" || !body.trim()) {
        res.status(400).json({ message: "body is required" });
        return;
      }
      if (!Array.isArray(recipients) || recipients.length === 0) {
        res.status(400).json({ message: "recipients must be a non-empty array" });
        return;
      }
      if (recipients.length > MAX_RECIPIENTS) {
        res.status(400).json({ message: `max ${MAX_RECIPIENTS} recipients per request` });
        return;
      }
      if (!sender || typeof sender !== "string" || !EMAIL_RE.test(sender.trim())) {
        res.status(400).json({ message: "sender must be a valid email" });
        return;
      }
      const parsedStart = startAt ? new Date(startAt as string).getTime() : Date.now();
      if (!Number.isFinite(parsedStart)) {
        res.status(400).json({ message: "startAt must be a valid ISO date" });
        return;
      }
      const start = Math.max(Date.now(), parsedStart);
      const gap = delayMs;
      const limit = Math.max(1, Math.min(Number(hourlyLimit) || env.maxEmailsPerHour, 1000));

      const clean = [...new Set(recipients.map((r) => String(r).trim().toLowerCase()))];
      const bad = clean.filter((r) => !EMAIL_RE.test(r));
      if (bad.length > 0) {
        res.status(400).json({ message: `invalid recipients: ${bad.slice(0, 5).join(", ")}` });
        return;
      }

      let attachmentsJson: string | null = null;
      if (attachments !== undefined) {
        if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) {
          res.status(400).json({ message: `max ${MAX_ATTACHMENTS} attachments` });
          return;
        }
        const stored: StoredAttachment[] = [];
        for (const a of attachments) {
          const meta = a as { name?: unknown; size?: unknown; type?: unknown; content?: unknown };
          if (
            typeof meta.name !== "string" ||
            !meta.name ||
            typeof meta.size !== "number" ||
            meta.size > MAX_ATTACHMENT_BYTES
          ) {
            res.status(400).json({ message: "invalid attachment metadata" });
            return;
          }
          if (typeof meta.content !== "string" || !meta.content) {
            res.status(400).json({ message: `attachment "${meta.name}" is missing file content` });
            return;
          }
          try {
            stored.push(
              await saveAttachment({
                name: meta.name,
                size: meta.size,
                type: typeof meta.type === "string" ? meta.type : "",
                content: meta.content,
              }),
            );
          } catch (saveErr) {
            res.status(400).json({
              message: String((saveErr as Error)?.message ?? saveErr).slice(0, 300),
            });
            return;
          }
        }
        attachmentsJson = JSON.stringify(stored);
      }

      const safeBody = sanitizeBody(body);
      const now = Date.now();
      const rows = clean.map((recipient, i) => ({
        id: randomUUID(),
        recipient,
        subject: subject.trim().slice(0, 500),
        body: safeBody,
        sender: sender.trim().toLowerCase(),
        sendAt: new Date(start + i * gap),
      }));

      try {
        await pool.query(
          "INSERT INTO emails (id, user_id, recipient, subject, body, sender, send_at, attachments, status) VALUES ?",
          [
            rows.map((r) => [
              r.id,
              userId,
              r.recipient,
              r.subject,
              r.body,
              r.sender,
              toMySQLDate(r.sendAt),
              attachmentsJson,
              "scheduled",
            ]),
          ],
        );
      } catch (dbErr) {
        const msg = String((dbErr as Error)?.message ?? dbErr);
        if (/Duplicate entry|ER_DUP_ENTRY/i.test(msg)) {
          res.status(409).json({ message: "Duplicate email record — try again" });
          return;
        }
        throw dbErr;
      }

      const enqueued: string[] = [];
      try {
        for (const r of rows) {
          const delay = Math.max(0, r.sendAt.getTime() - Date.now());
          await enqueueEmail(r.id, delay, limit, gap);
          enqueued.push(r.id);
        }
      } catch (qErr) {
        console.error("[schedule] BullMQ enqueue failed after DB insert:", qErr);
        res.status(503).json({
          message: "Emails saved but queue is temporarily unavailable — they will be retried",
          data: { count: enqueued.length, enqueuedIds: enqueued, pendingIds: rows.map((r) => r.id) },
        });
        return;
      }

      res.json({ data: { count: rows.length, ids: rows.map((r) => r.id) }, message: `Scheduled ${rows.length} emails` });
    } catch (err) {
      next(err);
    }
  },
);

scheduleRouter.get(
  "/scheduled",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthedRequest).userId;
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT * FROM emails WHERE user_id = ? AND status IN ('pending','scheduled') ORDER BY send_at ASC LIMIT 500",
        [userId],
      );
      res.json({ data: (rows as EmailRow[]).map(toEmailDto) });
    } catch (err) {
      next(err);
    }
  },
);

scheduleRouter.get(
  "/sent",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthedRequest).userId;
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT * FROM emails WHERE user_id = ? AND status IN ('sent','failed') ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 500",
        [userId],
      );
      res.json({ data: (rows as EmailRow[]).map(toEmailDto) });
    } catch (err) {
      next(err);
    }
  },
);

scheduleRouter.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthedRequest).userId;
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT * FROM emails WHERE id = ? AND user_id = ? LIMIT 1",
        [req.params.id, userId],
      );
      const row = (rows as EmailRow[])[0];
      if (!row) {
        res.status(404).json({ message: "Email not found" });
        return;
      }
      res.json({ data: toEmailDto(row) });
    } catch (err) {
      next(err);
    }
  },
);

scheduleRouter.get(
  "/:id/attachments/:index",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as AuthedRequest).userId;
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT * FROM emails WHERE id = ? AND user_id = ? LIMIT 1",
        [req.params.id, userId],
      );
      const row = (rows as EmailRow[])[0];
      if (!row) {
        res.status(404).json({ message: "Email not found" });
        return;
      }
      const stored = parseAttachments(row.attachments) as StoredAttachment[];
      const idx = Number(req.params.index);
      const att = Number.isInteger(idx) ? stored[idx] : undefined;
      if (!att?.file) {
        res.status(404).json({ message: "Attachment not found" });
        return;
      }
      const content = await readAttachment(att.file);
      res.setHeader("Content-Type", att.type || "application/octet-stream");
      res.setHeader("Content-Length", String(content.length));
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(att.name)}"`,
      );
      res.send(content);
    } catch (err) {
      next(err);
    }
  },
);
