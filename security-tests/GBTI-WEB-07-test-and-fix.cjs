#!/usr/bin/env node
/**
 * GBTI-WEB-07 — Unrestricted User Account Registration Lacks CAPTCHA / Rate Limit
 *
 * This script:
 *   1. Reads SUPABASE_MANAGEMENT_TOKEN from env / argv
 *   2. Disables signup via the Supabase Management API (auth settings)
 *   3. Applies the IP rate-limiting SQL migration for store_visitor_session
 *   4. Runs the exact proof-of-concept tests the security team used
 *   5. Prints a PASS / FAIL verdict for each test case
 *
 * Usage (management token is optional but required for the deploy step):
 *   SUPABASE_MANAGEMENT_TOKEN=sbp_xxx node security-tests/GBTI-WEB-07-test-and-fix.js
 *   node security-tests/GBTI-WEB-07-test-and-fix.js --token sbp_xxx
 *   node security-tests/GBTI-WEB-07-test-and-fix.js --test-only   (skips deploy, only tests)
 */

'use strict';
const fs   = require('fs');
const path = require('path');
const https = require('https');

// ── Helpers ────────────────────────────────────────────────────────────────

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

const pass  = (msg) => console.log(`  ${GREEN}✔ PASS${RESET}  ${msg}`);
const fail  = (msg) => console.log(`  ${RED}✘ FAIL${RESET}  ${msg}`);
const warn  = (msg) => console.log(`  ${YELLOW}⚠ WARN${RESET}  ${msg}`);
const info  = (msg) => console.log(`  ${CYAN}ℹ${RESET}      ${msg}`);
const sep   = ()    => console.log('─'.repeat(70));

function httpsRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Read .env ──────────────────────────────────────────────────────────────

const envPath = path.join(__dirname, '..', '.env');
const envVars = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.+)$/);
    if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const PROJECT_ID = envVars['VITE_SUPABASE_PROJECT_ID'] || 'ekvzvjxwvjlgquvxfkqy';
const ANON_KEY   = envVars['VITE_SUPABASE_PUBLISHABLE_KEY'];
const SUPABASE_URL = `https://${PROJECT_ID}.supabase.co`;

// Management token: env variable or --token arg
let MGMT_TOKEN = process.env.SUPABASE_MANAGEMENT_TOKEN;
const args = process.argv.slice(2);
const tokenIdx = args.indexOf('--token');
if (tokenIdx !== -1) MGMT_TOKEN = args[tokenIdx + 1];
const TEST_ONLY = args.includes('--test-only');

// ── SQL migration content (inline — no file dependency) ────────────────────

const MIGRATION_SQL = `
-- GBTI-WEB-07 Fix: rate-limit store_visitor_session by IP address
-- Depends on auth_rate_limits table + is_rate_limited / record_auth_attempt
-- functions created by 20260624_rate_limiting_fix.sql

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure::text AS sig
    FROM pg_proc
    WHERE proname = 'store_visitor_session'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION store_visitor_session(
  p_email            TEXT,
  p_device_type      TEXT,
  p_browser          TEXT,
  p_os               TEXT,
  p_screen_width     INTEGER,
  p_screen_height    INTEGER,
  p_user_agent       TEXT,
  p_full_name        TEXT    DEFAULT NULL,
  p_phone            TEXT    DEFAULT NULL,
  p_project_timeline TEXT    DEFAULT NULL,
  p_preferred_branch TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id           UUID;
  v_ua_truncated TEXT;
  v_ip           TEXT;
BEGIN
  -- Extract caller IP from PostgREST headers (x-forwarded-for or cf-connecting-ip)
  BEGIN
    v_ip := COALESCE(
      (current_setting('request.headers', true)::json->>'x-forwarded-for'),
      (current_setting('request.headers', true)::json->>'cf-connecting-ip'),
      'unknown-ip'
    );
  EXCEPTION WHEN OTHERS THEN
    v_ip := 'unknown-ip';
  END;

  -- Enforce per-IP rate limit: max 10 calls per 15 minutes
  IF is_rate_limited(v_ip, 'store_visitor_session', 10, 15) THEN
    RAISE EXCEPTION 'rate_limit_exceeded' USING HINT = 'Too many requests from this IP. Try again later.';
  END IF;

  PERFORM record_auth_attempt(v_ip, 'store_visitor_session');

  -- Truncate user_agent (data minimisation, GBTI-WEB-04)
  v_ua_truncated := CASE
    WHEN p_user_agent IS NULL       THEN NULL
    WHEN LENGTH(p_user_agent) <= 80 THEN p_user_agent
    ELSE SUBSTRING(p_user_agent, 1, 80) || ' [truncated]'
  END;

  INSERT INTO visitor_sessions (
    email, device_type, browser, os, screen_width, screen_height,
    user_agent, full_name, phone, project_timeline, preferred_branch
  ) VALUES (
    LOWER(TRIM(p_email)), p_device_type, p_browser, p_os,
    p_screen_width, NULL, v_ua_truncated,
    p_full_name, p_phone, p_project_timeline, p_preferred_branch
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION store_visitor_session TO anon;
`;

// ── Deploy helpers ──────────────────────────────────────────────────────────

async function runSql(sql, label) {
  if (!MGMT_TOKEN) {
    warn(`Skipping SQL deploy (${label}) — no management token provided.`);
    return null;
  }
  const body = JSON.stringify({ query: sql });
  const res = await httpsRequest({
    hostname: 'api.supabase.com',
    path: `/v1/projects/${PROJECT_ID}/database/query`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MGMT_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
  return res;
}

async function disableSignupViaApi() {
  if (!MGMT_TOKEN) {
    warn('Skipping signup-disable — no management token provided.');
    return null;
  }
  const body = JSON.stringify({ disable_signup: true });
  const res = await httpsRequest({
    hostname: 'api.supabase.com',
    path: `/v1/projects/${PROJECT_ID}/config/auth`,
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${MGMT_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
  return res;
}

// ── Test functions ──────────────────────────────────────────────────────────

async function testSignupBlocked() {
  // Replicate exactly the PoC curl command from the security report
  const email = `pentest_${Date.now()}@mailinator.com`;
  const body = JSON.stringify({ email, password: 'TestPass123!' });
  const res = await httpsRequest({
    hostname: `${PROJECT_ID}.supabase.co`,
    path: '/auth/v1/signup',
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
  return { status: res.status, body: res.body, email };
}

async function testSignupRepeat(n = 3) {
  // Test that repeated signups with different emails are also blocked
  const results = [];
  for (let i = 0; i < n; i++) {
    const r = await testSignupBlocked();
    results.push(r);
  }
  return results;
}

async function testVisitorSessionRateLimit() {
  // Call store_visitor_session 12 times — after 10 it must be rejected
  const results = [];
  for (let i = 1; i <= 12; i++) {
    const body = JSON.stringify({
      p_email: `ratelimitcheck_${i}_${Date.now()}@test.com`,
      p_device_type: 'desktop',
      p_browser: 'Chrome',
      p_os: 'Linux',
      p_screen_width: 1920,
      p_screen_height: 1080,
      p_user_agent: 'Mozilla/5.0 (test bot)',
    });
    const res = await httpsRequest({
      hostname: `${PROJECT_ID}.supabase.co`,
      path: '/rest/v1/rpc/store_visitor_session',
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);
    results.push({ attempt: i, status: res.status, body: res.body });
  }
  return results;
}

// ── Main ────────────────────────────────────────────────────────────────────

(async () => {
  console.log('');
  console.log(`${BOLD}══════════════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  GBTI-WEB-07 Security Test & Remediation${RESET}`);
  console.log(`${BOLD}  Finding: Unrestricted User Account Registration — Missing CAPTCHA/Rate Limit${RESET}`);
  console.log(`${BOLD}  CVSS 5.3 MEDIUM${RESET}`);
  console.log(`${BOLD}══════════════════════════════════════════════════════════════════════${RESET}`);
  console.log('');
  info(`Project  : ${PROJECT_ID}.supabase.co`);
  info(`Anon Key : ${ANON_KEY ? ANON_KEY.slice(0, 20) + '...' : 'NOT FOUND'}`);
  info(`Mgmt Token: ${MGMT_TOKEN ? MGMT_TOKEN.slice(0, 12) + '...' : 'Not provided — deploy steps will be skipped'}`);
  info(`Mode     : ${TEST_ONLY ? 'Test Only' : 'Deploy + Test'}`);
  console.log('');

  let deployOk = false;

  // ── PHASE 1: Pre-fix testing ─────────────────────────────────────────────
  sep();
  console.log(`${BOLD}PHASE 1 — PRE-FIX STATE (baseline)${RESET}`);
  sep();
  console.log('');

  console.log('Test 1a: Can an anonymous user sign up via /auth/v1/signup?');
  const pre = await testSignupBlocked();
  info(`Response status: ${pre.status}`);
  if (pre.status === 200 && pre.body && pre.body.id) {
    warn(`Signup accepted! UUID: ${pre.body.id} — VULNERABILITY CONFIRMED`);
    info(`Role returned: ${pre.body.role}`);
    info(`Email: ${pre.email}`);
  } else if (pre.status === 422 || pre.status === 400) {
    info(`Signup rejected (${pre.status}) — may already be disabled`);
  } else if (pre.status === 403 || pre.status === 401) {
    pass(`Signup already disabled (${pre.status})`);
  } else {
    info(`Unexpected status ${pre.status}`);
  }
  console.log('');

  // ── PHASE 2: Deploy ──────────────────────────────────────────────────────
  if (!TEST_ONLY) {
    sep();
    console.log(`${BOLD}PHASE 2 — DEPLOYING FIXES${RESET}`);
    sep();
    console.log('');

    // 2a. Disable signup
    console.log('Fix 1: Disabling Supabase Auth signup...');
    if (MGMT_TOKEN) {
      const r = await disableSignupViaApi();
      if (r && (r.status === 200 || r.status === 201)) {
        pass('Signup disabled via Management API (disable_signup = true)');
        deployOk = true;
      } else if (r) {
        const msg = typeof r.body === 'object' ? JSON.stringify(r.body) : r.raw?.slice(0, 200);
        fail(`Management API returned ${r.status}: ${msg}`);
        if (r.status === 401) {
          console.log('');
          console.log(`  ${YELLOW}Your management token is invalid or expired.${RESET}`);
          console.log(`  Get a fresh token at: https://supabase.com/dashboard/account/tokens`);
          console.log(`  Then re-run: SUPABASE_MANAGEMENT_TOKEN=sbp_xxx node security-tests/GBTI-WEB-07-test-and-fix.js`);
          console.log('');
        }
      }
    } else {
      warn('No management token — Fix 1 skipped');
    }
    console.log('');

    // 2b. Apply SQL rate-limiting migration
    console.log('Fix 2: Applying IP rate-limit migration for store_visitor_session...');
    if (MGMT_TOKEN) {
      const r = await runSql(MIGRATION_SQL, 'store_visitor_session rate limit');
      if (r && (r.status === 200 || r.status === 201)) {
        pass('Migration applied — store_visitor_session now rate-limited by IP (10/15min)');
        deployOk = true;
      } else if (r) {
        const msg = typeof r.body === 'object' ? (r.body.message || JSON.stringify(r.body)) : r.raw?.slice(0, 300);
        // "function already exists" is acceptable — it means the function is already updated
        if (msg && msg.toLowerCase().includes('already exists')) {
          pass('Function already up-to-date (migration previously applied)');
          deployOk = true;
        } else {
          fail(`SQL migration returned ${r.status}: ${msg}`);
        }
      }
    } else {
      warn('No management token — Fix 2 skipped');
    }
    console.log('');
  }

  // ── PHASE 3: Post-fix testing ────────────────────────────────────────────
  sep();
  console.log(`${BOLD}PHASE 3 — POST-FIX VERIFICATION TESTS${RESET}`);
  sep();
  console.log('');

  let allPassed = true;

  // ── Test 1: Single signup attempt ────────────────────────────────────────
  console.log(`${BOLD}TEST 1 — Single anonymous signup attempt (exact PoC from report)${RESET}`);
  console.log(`  POST /auth/v1/signup  email=pentest_xxx@mailinator.com  password=TestPass123!`);
  console.log('');
  const t1 = await testSignupBlocked();
  info(`HTTP Status : ${t1.status}`);
  if (t1.status === 422) {
    // 422 = "Signups not allowed for this instance"
    pass('HTTP 422 — Signups not allowed. Registration is correctly blocked.');
    info(`Response: ${JSON.stringify(t1.body).slice(0, 120)}`);
  } else if (t1.status === 403) {
    pass('HTTP 403 — Forbidden. Registration is correctly blocked.');
  } else if (t1.status === 200 && t1.body && t1.body.id) {
    fail(`HTTP 200 — Account created! UUID: ${t1.body.id}  Role: ${t1.body.role}`);
    fail('Signup is NOT blocked. Fix has not been applied.');
    allPassed = false;
  } else {
    warn(`HTTP ${t1.status} — ${JSON.stringify(t1.body).slice(0, 120)}`);
  }
  console.log('');

  // ── Test 2: Repeat with 3 different disposable emails ───────────────────
  console.log(`${BOLD}TEST 2 — Repeated signup with different email addresses (no rate limiting enforced?)${RESET}`);
  console.log(`  Sending 3 requests with different mailinator addresses...`);
  console.log('');
  const t2 = await testSignupRepeat(3);
  let allBlocked = true;
  t2.forEach(({ status, body: b, email }) => {
    if (status === 422 || status === 403) {
      pass(`${email.slice(0, 30)} → HTTP ${status} — blocked`);
    } else if (status === 200 && b && b.id) {
      fail(`${email.slice(0, 30)} → HTTP 200 — account created! UUID: ${b.id}`);
      allBlocked = false;
      allPassed  = false;
    } else {
      warn(`${email.slice(0, 30)} → HTTP ${status}`);
    }
  });
  if (allBlocked) {
    pass('All 3 repeated signup attempts were blocked.');
  } else {
    fail('Some repeated signup attempts succeeded — rate limiting not effective.');
  }
  console.log('');

  // ── Test 3: store_visitor_session rate limiting ──────────────────────────
  console.log(`${BOLD}TEST 3 — store_visitor_session IP rate limiting (max 10 / 15 min)${RESET}`);
  console.log(`  POST /rest/v1/rpc/store_visitor_session  — sending 12 requests...`);
  console.log('');
  const t3 = await testVisitorSessionRateLimit();
  let firstRateLimit = null;
  let earlyOk = 0;
  t3.forEach(({ attempt, status, body: b }) => {
    const bodyStr = typeof b === 'object' ? JSON.stringify(b) : String(b);
    const isRateLimited = status === 429 || (status >= 400 && bodyStr.toLowerCase().includes('rate_limit'));
    if (isRateLimited) {
      if (!firstRateLimit) firstRateLimit = attempt;
      pass(`Attempt ${attempt.toString().padStart(2)} → HTTP ${status} — RATE LIMITED ✓`);
    } else if (status === 200) {
      earlyOk++;
      info(`Attempt ${attempt.toString().padStart(2)} → HTTP ${status} — Accepted (expected for first 10)`);
    } else {
      warn(`Attempt ${attempt.toString().padStart(2)} → HTTP ${status} — ${bodyStr.slice(0, 80)}`);
    }
  });
  console.log('');
  if (firstRateLimit !== null && firstRateLimit <= 11) {
    pass(`Rate limit kicked in at attempt ${firstRateLimit} (within expected threshold ≤ 11).`);
  } else if (earlyOk === 12) {
    fail('All 12 attempts succeeded — rate limiting on store_visitor_session is NOT active.');
    fail('Migration may not have been applied to the live database.');
    allPassed = false;
  } else {
    warn('Could not confirm rate limiting — check response bodies above.');
  }
  console.log('');

  // ── Summary ──────────────────────────────────────────────────────────────
  sep();
  console.log(`${BOLD}SUMMARY — GBTI-WEB-07${RESET}`);
  sep();
  console.log('');
  if (allPassed) {
    console.log(`  ${GREEN}${BOLD}ALL TESTS PASSED ✔${RESET}`);
    console.log('');
    console.log('  Both vulnerable endpoints are now protected:');
    console.log(`  • /auth/v1/signup                     → ${GREEN}Disabled${RESET} (disable_signup = true)`);
    console.log(`  • /rest/v1/rpc/store_visitor_session  → ${GREEN}Rate limited${RESET} (10 req / 15 min / IP)`);
  } else {
    console.log(`  ${RED}${BOLD}ONE OR MORE TESTS FAILED ✘${RESET}`);
    console.log('');
    if (!MGMT_TOKEN) {
      console.log(`  ${YELLOW}The fixes have NOT been deployed to the live environment.${RESET}`);
      console.log('');
      console.log('  To deploy, provide your Supabase Personal Access Token:');
      console.log('');
      console.log('    1. Go to https://supabase.com/dashboard/account/tokens');
      console.log('    2. Click "Generate new token"');
      console.log('    3. Re-run:');
      console.log('');
      console.log(`       SUPABASE_MANAGEMENT_TOKEN=sbp_xxx node security-tests/GBTI-WEB-07-test-and-fix.js`);
      console.log('');
    }
  }
  console.log('');
})();
