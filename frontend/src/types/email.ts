export type EmailStatus = "pending" | "sent" | "failed" | "scheduled" | "processing";

export interface AttachmentMeta {
  name: string;
  size: number;
  type: string;
  content?: string;
}

export interface Email {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  sender: string;
  fromName?: string;
  sendAt: string;
  sentAt?: string | null;
  status: EmailStatus;
  createdAt?: string;
  updatedAt?: string;
  previewUrl?: string | null;
  attachments?: AttachmentMeta[];
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface ComposePayload {
  subject: string;
  body: string;
  recipients: string[];
  sender: string;
  startAt: string;
  delayBetweenEmails: number;
  hourlyLimit: number;
  attachments?: AttachmentMeta[];
}

export interface User {
  name: string;
  email: string;
  avatarUrl: string;
}
