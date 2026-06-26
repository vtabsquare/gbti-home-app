#!/usr/bin/env node
// ============================================================
// SCR-GBTI-02 Security Fix Verification Script (Final)
// Tests that anon write access to admin_settings and
// package_layouts has been fully blocked.
//
// Run after applying both migrations:
//   - supabase/migrations/20260626_fix_anon_write_access.sql
//   - supabase/migrations/20260626_drop_old_upsert_overload.sql
// ============================================================

const SUPABASE_URL  = 'https://ekvzvjxwvjlgquvxfkqy.supabase.co';
const ANON_KEY      = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrdnp2anh3dmpsZ3F1dnhma3F5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMzI1NDgsImV4cCI6MjA5MzYwODU0OH0.fzmxDHQZ-jIJXTu88HgnMAdd58LBMgnD0vscYSRHWzI';

const RPC_HEADERS = {
  'apikey':          ANON_KEY,
  'Authorization':   `Bearer ${ANON_KEY}`,
  'Content-Type':    'application/json',
  'Content-Profile': 'api',
};

const TABLE_HEADERS = {
  'apikey':          ANON_KEY,
  'Authorization':   `Bearer ${ANON_KEY}`,
  'Content-Type':    'application/json',
  'Prefer':          'return=representation',
};

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    const result = await fn();
    if (result.ok) {
      console.log(`  ✅  PASS  ${name}`);
      console.log(`            ${result.detail}`);
      passed++;
    } else {
      console.log(`  ❌  FAIL  ${name}`);
      console.log(`            ${result.detail}`);
      failed++;
    }
  } catch (e) {
    console.log(`  💥  ERROR ${name}: ${e.message}`);
    failed++;
  }
}

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: RPC_HEADERS, body: JSON.stringify(args),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

async function restTable(method, table, query, body) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? '?' + query : ''}`;
  const opts = { method, headers: { ...TABLE_HEADERS } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

// ─── SECTION 1: admin_settings write blocked ────────────────
console.log('\n══════════════════════════════════════════════════');
console.log(' SECTION 1: admin_settings — direct REST writes blocked');
console.log('══════════════════════════════════════════════════');

await test('PATCH /admin_settings?key=eq.pricing — write blocked', async () => {
  const r = await restTable('PATCH', 'admin_settings', 'key=eq.pricing', { value: { INJECTED: true } });
  if (r.status === 403 || r.status === 401 || r.status === 404) {
    return { ok: true, detail: `HTTP ${r.status} — blocked` };
  }
  if (r.status === 204 || r.status === 200) {
    const check = await rpc('get_pricing', {});
    if (check.json?.value?.INJECTED === true) {
      return { ok: false, detail: `❗ DATA WAS MODIFIED — pricing.INJECTED=true written!` };
    }
    return { ok: true, detail: `HTTP ${r.status} — 0 rows affected, RLS blocked (verified by read-back)` };
  }
  return { ok: false, detail: `Unexpected ${r.status} — ${r.text.slice(0, 300)}` };
});

await test('DELETE /admin_settings?key=eq.pricing — delete blocked', async () => {
  const r = await restTable('DELETE', 'admin_settings', 'key=eq.pricing');
  if (r.status === 403 || r.status === 401 || r.status === 404) {
    return { ok: true, detail: `HTTP ${r.status} — blocked` };
  }
  if (r.status === 204) {
    const check = await rpc('get_pricing', {});
    if (!check.json) return { ok: false, detail: `❗ PRICING ROW DELETED!` };
    return { ok: true, detail: `HTTP 204 but pricing row still exists (RLS blocked)` };
  }
  return { ok: false, detail: `Unexpected ${r.status} — ${r.text.slice(0, 300)}` };
});

await test('POST /admin_settings — inject key blocked', async () => {
  const r = await restTable('POST', 'admin_settings', '', { key: 'scr02_inject_test', value: { x: 1 } });
  if (r.status === 403 || r.status === 401 || r.status === 404 || r.status === 409) {
    return { ok: true, detail: `HTTP ${r.status} — blocked` };
  }
  const check = await restTable('GET', 'admin_settings', 'key=eq.scr02_inject_test&select=key');
  if (Array.isArray(check.json) && check.json.length > 0) {
    await restTable('DELETE', 'admin_settings', 'key=eq.scr02_inject_test');
    return { ok: false, detail: `❗ INJECTION SUCCEEDED — anon inserted new admin_settings row!` };
  }
  return { ok: true, detail: `HTTP ${r.status} — row not written (schema/RLS blocked)` };
});

// ─── SECTION 2: package_layouts write blocked ────────────────
console.log('\n══════════════════════════════════════════════════');
console.log(' SECTION 2: package_layouts — direct REST writes blocked');
console.log('══════════════════════════════════════════════════');

await test('PATCH /package_layouts — overwrite blocked', async () => {
  const layouts = await rpc('get_package_layouts', {});
  const pkgKey = Array.isArray(layouts.json) && layouts.json[0]?.package_key;
  if (!pkgKey) return { ok: true, detail: 'No rows to target — table empty (safe)' };
  const r = await restTable('PATCH', 'package_layouts', `package_key=eq.${encodeURIComponent(pkgKey)}`,
    { plan_data: { INJECTED: true } });
  if (r.status === 403 || r.status === 401 || r.status === 404) {
    return { ok: true, detail: `HTTP ${r.status} — blocked for key: ${pkgKey}` };
  }
  if (r.status === 204 || r.status === 200) {
    const check = await rpc('get_package_layouts', {});
    const row = Array.isArray(check.json) ? check.json.find(x => x.package_key === pkgKey) : null;
    if (row?.plan_data?.INJECTED === true) {
      return { ok: false, detail: `❗ PLAN DATA OVERWRITTEN for key: ${pkgKey}` };
    }
    return { ok: true, detail: `HTTP ${r.status} — data NOT modified (RLS blocked)` };
  }
  return { ok: false, detail: `Unexpected ${r.status} — ${r.text.slice(0, 300)}` };
});

await test('POST /package_layouts — inject layout blocked', async () => {
  const r = await restTable('POST', 'package_layouts', '', { package_key: 'scr02_inject_test', plan_data: { x: 1 } });
  if (r.status === 403 || r.status === 401 || r.status === 404 || r.status === 409) {
    return { ok: true, detail: `HTTP ${r.status} — blocked` };
  }
  const check = await rpc('get_package_layouts', {});
  const wasWritten = Array.isArray(check.json) && check.json.some(x => x.package_key === 'scr02_inject_test');
  if (wasWritten) return { ok: false, detail: `❗ INJECTION SUCCEEDED — new layout row written!` };
  return { ok: true, detail: `HTTP ${r.status} — row not written (schema/RLS blocked)` };
});

// ─── SECTION 3: upsert_package_layout RPC token gate ────────
console.log('\n══════════════════════════════════════════════════');
console.log(' SECTION 3: api.upsert_package_layout — token required');
console.log(' NOTE: Run migration 20260626_drop_old_upsert_overload.sql first!');
console.log('══════════════════════════════════════════════════');

await test('RPC upsert_package_layout with NO token → rejected (needs patch migration)', async () => {
  const r = await rpc('upsert_package_layout', {
    p_package_key: 'scr02_no_token_test',
    p_plan_data:   { INJECTED: true },
  });
  // HTTP 300 = overload ambiguity (old function still exists — patch migration not yet applied)
  if (r.status === 300) {
    return { ok: false, detail: `HTTP 300 (PGRST203) — old 2-arg overload still exists! Run migration 20260626_drop_old_upsert_overload.sql in Supabase SQL Editor.` };
  }
  const blocked = r.status === 401 || r.status === 403 || r.status === 400 ||
    r.status === 404 || (r.json?.message?.includes('Unauthorized'));
  return { ok: blocked, detail: `HTTP ${r.status} — ${JSON.stringify(r.json).slice(0, 200)}` };
});

await test('RPC upsert_package_layout with EMPTY token → rejected', async () => {
  const r = await rpc('upsert_package_layout', {
    p_package_key: 'scr02_empty_token_test',
    p_plan_data:   { INJECTED: true },
    p_token:       '',
  });
  const blocked = r.status !== 200 || (r.json?.message?.includes('Unauthorized'));
  return { ok: blocked, detail: `HTTP ${r.status} — ${JSON.stringify(r.json).slice(0, 200)}` };
});

await test('RPC upsert_package_layout with FAKE token → rejected', async () => {
  const r = await rpc('upsert_package_layout', {
    p_package_key: 'scr02_fake_token_test',
    p_plan_data:   { INJECTED: true },
    p_token:       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });
  const blocked = r.status !== 200 || (r.json?.message?.includes('Unauthorized'));
  const check = await rpc('get_package_layouts', {});
  if (Array.isArray(check.json) && check.json.some(x => x.package_key === 'scr02_fake_token_test')) {
    return { ok: false, detail: `❗ FAKE TOKEN ACCEPTED — data was written!` };
  }
  return { ok: blocked, detail: `HTTP ${r.status} — ${JSON.stringify(r.json).slice(0, 200)}` };
});

// ─── SECTION 4: Read access still works ─────────────────────
console.log('\n══════════════════════════════════════════════════');
console.log(' SECTION 4: Read access still works (no regression)');
console.log('══════════════════════════════════════════════════');

await test('RPC get_pricing returns live data', async () => {
  const r = await rpc('get_pricing', {});
  const ok = r.status === 200 && r.json?.value && typeof r.json.value.sqft_rate === 'number';
  return { ok, detail: `HTTP ${r.status} — ${ok ? `sqft_rate=${r.json.value.sqft_rate}` : r.text.slice(0,200)}` };
});

await test('RPC get_package_layouts returns data', async () => {
  const r = await rpc('get_package_layouts', {});
  const ok = r.status === 200 && Array.isArray(r.json);
  return { ok, detail: `HTTP ${r.status} — ${ok ? `${r.json.length} layouts` : r.text.slice(0,200)}` };
});

await test('RPC get_mortgage_settings returns data', async () => {
  const r = await rpc('get_mortgage_settings', {});
  const ok = r.status === 200 && r.json !== null;
  return { ok, detail: `HTTP ${r.status} — ${ok ? 'mortgage settings OK' : r.text.slice(0,200)}` };
});

await test('RPC get_presets returns data', async () => {
  const r = await rpc('get_presets', {});
  const ok = r.status === 200 && Array.isArray(r.json);
  return { ok, detail: `HTTP ${r.status} — ${ok ? `${r.json.length} presets` : r.text.slice(0,200)}` };
});

await test('RPC submit_lead works (visitor form)', async () => {
  const testId = '10000000-0000-0000-0000-000000000099';
  const r = await rpc('submit_lead', {
    p_id: testId, p_name: 'SCR02 Test', p_phone: '+592 000-9999',
    p_email: 'scr02-test@example.com', p_config: {}, p_total_cost: 1000000,
  });
  const ok = r.status === 200 || r.status === 409;
  return { ok, detail: `HTTP ${r.status} — ${ok ? 'lead submission works' : r.text.slice(0,200)}` };
});

await test('RPC send_admin_login_otp works', async () => {
  const r = await rpc('send_admin_login_otp', { p_email: 'nonexistent@test.com' });
  const ok = r.status === 200 || r.status === 404;
  return { ok, detail: `HTTP ${r.status} — admin OTP RPC reachable` };
});

// ─── SECTION 5: Audit log ────────────────────────────────────
console.log('\n══════════════════════════════════════════════════');
console.log(' SECTION 5: Audit log infrastructure');
console.log('══════════════════════════════════════════════════');

await test('Anon cannot read admin_audit_log', async () => {
  const r = await restTable('GET', 'admin_audit_log', 'select=id&limit=1');
  const blocked = r.status === 403 || r.status === 401 || r.status === 404 ||
    (r.status === 200 && Array.isArray(r.json) && r.json.length === 0);
  return { ok: blocked, detail: `HTTP ${r.status} — ${blocked ? 'protected' : 'anon can read audit log!'}` };
});

await test('RPC admin_get_audit_log requires valid token', async () => {
  const r = await rpc('admin_get_audit_log', { p_token: 'fake_token', p_limit: 5 });
  const blocked = r.status !== 200 || r.json?.message?.includes('Unauthorized');
  return { ok: blocked, detail: `HTTP ${r.status} — ${JSON.stringify(r.json).slice(0,200)}` };
});

// ─── SUMMARY ────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════');
console.log(` RESULTS: ${passed} passed | ${failed} failed | ${passed + failed} total`);
console.log('══════════════════════════════════════════════════');

if (failed === 0) {
  console.log('\n🔒  ALL TESTS PASSED — SCR-GBTI-02 fully remediated.\n');
} else {
  const needsPatch = failed === 1;
  console.log('\n⚠️  ' + failed + ' test(s) failed.');
  if (needsPatch) {
    console.log('\n    → If the only failure is "upsert_package_layout with NO token",');
    console.log('      run migration 20260626_drop_old_upsert_overload.sql in Supabase.\n');
  }
  process.exit(1);
}
