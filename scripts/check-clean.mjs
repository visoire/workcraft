#!/usr/bin/env node
// Upload guard for the private workcraft repository.
//
// The website (homepage, contact, portal, panel, dashboard, legal pages, error pages, redirects,
// backup/) and the workspace may go into the repository. The check only stops when
//   1. files from private/ (credentials, databases, outbox) or database files are in the commit,
//   2. a file contains a plain-text API key, a password or a private key,
//   3. a file is too large for GitHub (over 95 MB; GitHub refuses 100 MB) or is an upstream
//      trademark asset (docs/brand/ of the engines).
//
// Usage: npm run check:clean (also as a pre-commit hook: git config core.hooksPath .githooks)
// Deliberate exception on one line: put the comment "check-clean: allowed" on that line.
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

// Everything `git add -A` would pick up (index plus new files that are not ignored)
const files = execSync('git ls-files --cached --others --exclude-standard -z', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0')
  .filter(Boolean)
  .map((f) => f.replace(/\\/g, '/'));

const forbiddenPaths = [
  [/(^|\/)private\//i, 'private/ folder (credentials, databases)'],
  [/(^|\/)storage\/outbox\//i, 'mail outbox'],
  [/\.(sqlite3?|db|db-journal|db-wal|db-shm|dump)$/i, 'database file'],
  [/(^|\/)\.env(\.(?!example$)[^/]*)?$/i, 'environment variables'],
  [/(^|\/)config\.local\.|\.local\.php$|\.secret\./i, 'local configuration'],
  [/\.(pem|key|p12|pfx)$|(^|\/)id_(rsa|ed25519)/i, 'private key'],
  [/(^|\/)DEMO-ACCOUNT\.md$/i, 'demo credentials'],
  [/(^|\/)docs\/brand\//i, 'trademark assets of the engines (docs/brand/)'],
];

// GitHub rejects files of 100 MB and more and warns from 50 MB
const MAX_BYTES = 95 * 1024 * 1024;
const WARN_BYTES = 50 * 1024 * 1024;

// Plain-text keys and passwords in file contents
const secretPatterns = [
  [/sk-ant-(api|admin)\d{2}-[A-Za-z0-9_-]{20,}/, 'Anthropic API key'],
  [/\bsk-(proj-|svcacct-)?[A-Za-z0-9_-]{32,}/, 'OpenAI or DeepSeek API key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key (Gemini)'],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|github_pat_[A-Za-z0-9_]{60,}/, 'GitHub token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\b(sk|rk)_live_[A-Za-z0-9]{20,}/, 'Stripe key'],
  [/-----BEGIN (RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/, 'private key'],
  [/\b(postgres(ql)?|mysql|mariadb|mongodb(\+srv)?):\/\/[^\s:'"/]+:[^\s@'"/]{3,}@/i, 'database URL with password'],
  // PHP and config files: password as a non-empty literal
  [/\b(DB_PASS(WORD)?|DB_PASSWD|MAIL_PASS(WORD)?|SMTP_PASS(WORD)?|API_KEY|SECRET_KEY|PGPASSWORD)\b['"]?\s*(=>|=|,|:)\s*['"][^'"\s$]{6,}['"]/i, 'password or key in plain text'],
];

const TEXT_EXT = /\.(php|js|mjs|cjs|ts|tsx|jsx|json|md|txt|html|htm|css|ini|env|ya?ml|toml|xml|sh|ps1|bat|cmd|conf|cfg|sql|py|htaccess)$|(^|\/)\.htaccess$|(^|\/)[^.]+$/i;
const SKIP_CONTENT = /^(versions\/|node_modules\/)|package-lock\.json$/;
const ALLOW_LINE = /check-clean:\s*allowed/;

const problems = [];
const warnings = [];
let scanned = 0;
for (const file of files) {
  for (const [re, label] of forbiddenPaths) if (re.test(file)) problems.push(`${file}: ${label}`);
  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    continue; // deleted in the working tree
  }
  if (size > MAX_BYTES) problems.push(`${file}: ${(size / 1048576).toFixed(1)} MB, too large for GitHub (limit 100 MB). Keep it out via .gitignore.`);
  else if (size > WARN_BYTES) warnings.push(`${file}: ${(size / 1048576).toFixed(1)} MB (GitHub warns from 50 MB)`);
  if (SKIP_CONTENT.test(file) || !TEXT_EXT.test(file)) continue;
  let text;
  try {
    if (size > 5 * 1024 * 1024) continue;
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  scanned++;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (ALLOW_LINE.test(line)) return;
    for (const [re, label] of secretPatterns) if (re.test(line)) problems.push(`${file}:${i + 1}: ${label}`);
  });
}

for (const w of warnings) console.warn('warning: ' + w);
if (problems.length) {
  console.error('Upload stopped. Credentials or private data do not belong in the repository:');
  for (const p of problems) console.error('  ' + p);
  console.error('\nAdd private files to .gitignore or move the key out of the file (for example into private/config.php).');
  process.exit(1);
}
console.log(`check:clean ok, ${files.length} files checked, ${scanned} text files scanned for keys.`);
