#!/usr/bin/env node
/**
 * GBTI-WEB-05 Fix: Apply rate-limiting migration via Supabase Management API
 *
 * Usage:
 *   node security-tests/apply-migration.js <SUPABASE_MANAGEMENT_TOKEN>
 *
 * Get your management token at:
 *   https://supabase.com/dashboard/account/tokens
 *
 * The script reads VITE_SUPABASE_PROJECT_ID from .env automatically.
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

// -- Read .env -------------------------------------------------------
const envPath = path.join(__dirname, '..', '.env');
const envVars = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.+)$/);
    if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const projectId = envVars['VITE_SUPABASE_PROJECT_ID'];
if (!projectId) {
  console.error('[ERROR] VITE_SUPABASE_PROJECT_ID not found in .env');
  process.exit(1);
}

const token = process.argv[2];
if (!token) {
  console.error('[ERROR] Missing management token.');
  console.error('Usage: node security-tests/apply-migration.js <SUPABASE_MANAGEMENT_TOKEN>');
  console.error('Get your token at: https://supabase.com/dashboard/account/tokens');
  process.exit(1);
}

// -- Read SQL migration ----------------------------------------------
const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260624_rate_limiting_fix.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

console.log('');
console.log('============================================================');
console.log('  GBTI-WEB-05: Applying Rate Limiting Migration');
console.log('============================================================');
console.log('  Project ID : ' + projectId);
console.log('  SQL File   : 20260624_rate_limiting_fix.sql');
console.log('  Endpoint   : https://api.supabase.com/v1/projects/' + projectId + '/database/query');
console.log('');
console.log('  Sending SQL to Supabase Management API...');

// -- Post to Management API ------------------------------------------
const body = JSON.stringify({ query: sql });

const options = {
  hostname: 'api.supabase.com',
  path:     '/v1/projects/' + projectId + '/database/query',
  method:   'POST',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type':  'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('  [SUCCESS] Migration applied successfully!');
      console.log('');
      console.log('  Objects created:');
      console.log('    - auth_rate_limits table');
      console.log('    - is_rate_limited() function');
      console.log('    - record_auth_attempt() function');
      console.log('    - send_admin_login_otp() [updated with rate limit]');
      console.log('    - verify_admin_login_otp() [updated with lockout]');
      console.log('    - store_visitor_otp() [updated with rate limit]');
      console.log('    - verify_visitor_otp() [updated with rate limit]');
      console.log('    - failed_otp_attempts + locked_until columns on admin_users');
      console.log('');
      console.log('  Next step: run the test again to verify protection:');
      console.log('  powershell -ExecutionPolicy Bypass -File security-tests\\test-brute-force-GBTI-WEB-05.ps1');
      console.log('');
    } else {
      console.error('  [ERROR] HTTP ' + res.statusCode);
      try {
        const parsed = JSON.parse(data);
        console.error('  Message:', parsed.message || parsed.error || data);
      } catch {
        console.error('  Response:', data.substring(0, 500));
      }
      console.error('');
      console.error('  If you see a 401, your management token may be expired or invalid.');
      console.error('  Get a new one at: https://supabase.com/dashboard/account/tokens');
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.error('  [ERROR] Network error:', e.message);
  process.exit(1);
});

req.write(body);
req.end();
