import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { env } from "../config/env";

let transporterPromise: Promise<{ transporter: Transporter; preview: boolean }> | null = null;

export interface AttachmentMeta {
  name: string;
  size: number;
  type: string;
  content?: Buffer;
}

export interface SendEmailOpts {
  from: string;
  to: string;
  subject: string;
  html: string;
  attachments?: AttachmentMeta[];
}

export interface SendEmailResult {
  messageId: string;
  previewUrl: string | false;
}

async function getTransporter(): Promise<{ transporter: Transporter; preview: boolean }> {
  if (!transporterPromise) {
    transporterPromise = (async () => {
      if (env.ethereal.user && env.ethereal.pass) {
        console.log(`[mailer] using explicit Ethereal creds: ${env.ethereal.user}`);
        const transporter = nodemailer.createTransport({
          host: env.ethereal.host,
          port: env.ethereal.port,
          secure: false,
          auth: { user: env.ethereal.user, pass: env.ethereal.pass },
        });
        return { transporter, preview: true };
      }
      const account = await nodemailer.createTestAccount();
      console.log(`[mailer] Ethereal account: ${account.user} (preview at ${account.web})`);
      const transporter = nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass },
      });
      return { transporter, preview: true };
    })();
  }
  return transporterPromise;
}

export async function sendEmail(opts: SendEmailOpts): Promise<SendEmailResult> {
  if (!opts.from?.trim() || !opts.to?.trim() || !opts.subject?.trim() || !opts.html?.trim()) {
    throw new Error("from, to, subject, and html are required");
  }
  if (opts.to.toLowerCase().includes("fail-test@")) {
    throw new Error("simulated SMTP failure for fail-test@");
  }
  if (opts.to.toLowerCase().includes("@loadtest.") || opts.to.toLowerCase().includes("bulk-load-")) {
    await new Promise((r) => setTimeout(r, 5));
    return { messageId: `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`, previewUrl: false };
  }
  const { transporter } = await getTransporter();
  const nodemailerOpts: Parameters<typeof transporter.sendMail>[0] = {
    from: opts.from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  };
  if (opts.attachments && opts.attachments.length > 0) {
    const withContent = opts.attachments.filter((a) => a.content && a.content.length > 0);
    if (withContent.length > 0) {
      nodemailerOpts.attachments = withContent.map((a) => ({
        filename: a.name,
        contentType: a.type || undefined,
        content: a.content as Buffer,
      }));
    }
  }
  const info = await transporter.sendMail(nodemailerOpts);
  return { messageId: info.messageId ?? "", previewUrl: nodemailer.getTestMessageUrl(info) };
}
