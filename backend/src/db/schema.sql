CREATE TABLE IF NOT EXISTS emails (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(64) NULL,
  recipient VARCHAR(320) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  sender VARCHAR(320) NOT NULL,
  from_name VARCHAR(320) NULL,
  send_at DATETIME(3) NOT NULL,
  sent_at DATETIME(3) NULL,
  status ENUM('pending','scheduled','processing','sent','failed') NOT NULL DEFAULT 'scheduled',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  preview_url TEXT NULL,
  attachments JSON NULL,
  idempotency_key VARCHAR(255) NULL UNIQUE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_status_sendat (status, send_at),
  INDEX idx_user_status (user_id, status),
  INDEX idx_recipient (recipient),
  INDEX idx_user_id (user_id),
  INDEX idx_send_at (send_at)
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  google_id VARCHAR(255) NULL UNIQUE,
  email VARCHAR(320) NOT NULL UNIQUE,
  name VARCHAR(320) NOT NULL DEFAULT '',
  avatar_url TEXT NULL,
  password_hash VARCHAR(255) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_google_id (google_id),
  INDEX idx_email (email)
);

ALTER TABLE users DROP COLUMN avatar;
ALTER TABLE users ADD COLUMN avatar_url TEXT NULL AFTER name;
ALTER TABLE users MODIFY COLUMN google_id VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER created_at;
ALTER TABLE users ADD INDEX idx_google_id (google_id);
ALTER TABLE users ADD INDEX idx_email (email);
ALTER TABLE emails ADD INDEX idx_recipient (recipient);
ALTER TABLE emails ADD INDEX idx_user_id (user_id);
ALTER TABLE emails ADD INDEX idx_send_at (send_at);
ALTER TABLE emails ADD COLUMN idempotency_key VARCHAR(255) NULL AFTER attachments;
ALTER TABLE emails ADD UNIQUE INDEX idx_idempotency_key (idempotency_key);
ALTER TABLE emails ADD COLUMN preview_url TEXT NULL AFTER last_error;
