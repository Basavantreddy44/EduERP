// Point every test at the isolated test database before any app module is imported.
const testUrl = process.env.TEST_DATABASE_URL;
const testOwnerUrl = process.env.TEST_DATABASE_OWNER_URL;
if (!testUrl || !testOwnerUrl) throw new Error('TEST_DATABASE_URL and TEST_DATABASE_OWNER_URL must be set (see .env.example)');
process.env.DATABASE_URL = testUrl;
process.env.DATABASE_OWNER_URL = testOwnerUrl;
process.env.NODE_ENV = 'test';
// Reuse detection is tested immediately after rotation, so the benign-race grace window is off.
process.env.REFRESH_REUSE_GRACE_SECONDS = '0';
// Uploaded files go to a throwaway folder; email goes to Mailpit (docker compose service).
process.env.FILES_DIR = require('node:path').join(require('node:os').tmpdir(), 'eduerp-test-files');
process.env.SMTP_HOST = process.env.SMTP_HOST || 'localhost';
process.env.SMTP_PORT = process.env.SMTP_PORT || '1025';
process.env.OUTBOX_POLL_MS = '200';
