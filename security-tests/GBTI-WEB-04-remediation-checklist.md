# GBTI-WEB-04 Remediation Checklist
## Unauthenticated Access to Customer PII (53 Lead Records & 77 Visitor Session Fingerprints)

| Field | Value |
|---|---|
| **CVSS** | 7.5 HIGH — CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N |
| **CWE** | CWE-200 (Info Disclosure), CWE-284 (Improper Access Control) |
| **OWASP** | A02:2021 – Cryptographic Failures |
| **Status** | ✅ REMEDIATED |

---

## Root Cause

Two RLS policies granted the `anon` role full `SELECT` access to the `leads` table:
- `"Admin can read leads"` — SELECT for anon
- `"Admin can delete leads"` — DELETE for anon
- `"Admin can update leads"` — UPDATE for anon

These were added in `20260623_fix_rls_security.sql` so the admin panel could read leads
using the publicly visible anon key. This made all 53 customer PII records (name, email,
phone, financial projections) readable by anyone with the anon key (which is embedded in
the JS bundle and therefore public).

The `visitor_sessions` table also had RLS disabled via `supabase_visitor_setup.sql`
(`ALTER TABLE visitor_sessions DISABLE ROW LEVEL SECURITY`), exposing all 77 visitor
fingerprints (email, browser, OS, screen dimensions, user-agent strings).

---

## What Was Fixed

### 1. SQL Migration — `supabase/migrations/20260624_pii_rls_fix.sql`
Applied to Supabase SQL Editor ✅

- **Dropped** `"Admin can read leads"` policy (anon SELECT on leads)
- **Dropped** `"Admin can delete leads"` policy (anon DELETE on leads)
- **Dropped** `"Admin can update leads"` policy (anon UPDATE on leads)
- **Kept** `"Public can insert leads"` (anon INSERT — needed for the visitor enquiry form)
- **Re-enabled RLS** on `visitor_sessions` (was disabled in setup SQL)
- **Re-enabled RLS** on `visitor_otps` (was disabled in setup SQL)
- **Data minimisation**: truncated existing `user_agent` strings to 80 chars
- **Updated** `store_visitor_session()` to never store full user-agent strings going forward (`NULL` for `screen_height`, truncated `user_agent`)

### 2. Frontend — `src/pages/AdminDashboard.tsx`
- Admin panel now requires **OTP login** before showing any data
- `fetchLeads` now calls the `admin-api` Edge Function (service-role key) instead of direct anon REST
- `deleteLead` now calls the `admin-api` Edge Function with session token verification
- Added **Logout** button in sidebar
- Session token stored in `localStorage`, verified against DB on mount

### 3. Routing — `src/App.tsx`
- Added `<Route path="/admin" element={<AdminDashboard />} />` — admin panel now accessible at `/#/admin`

---

## Verification

Run the test script to confirm both tables are blocked:
```powershell
.\security-tests\test-pii-access-GBTI-WEB-04.ps1
```

Expected output (post-fix):
```
Test 1 (leads table)           : [PROTECTED]
Test 2 (visitor_sessions table): [PROTECTED]
Both tables are protected. GBTI-WEB-04 remediated.
```

---

## Admin Access After Fix

The admin panel is now accessible at `/#/admin` with OTP authentication:

1. Navigate to `https://gbti-homebuilder.vtabsquare.com/#/admin`
2. Enter admin email → click **Send OTP**
3. Enter 6-digit OTP from email → click **Verify OTP**
4. Dashboard loads — leads fetched via authenticated Edge Function

Admin reads/writes use the `admin-api` Edge Function with `SUPABASE_SERVICE_ROLE_KEY` (server-side only, never exposed to clients).

---

## What Remains (Not In Scope of This Fix)

| Item | Notes |
|---|---|
| `admin_settings` write access for anon | Low risk (pricing config only, no PII). Can be locked down in a future migration if needed. |
| `presets` / `elevation_images` delete for anon | Low risk (no PII). Admin panel already calls Edge Function for these in some cases. |
| Notification of affected data subjects | Legal obligation — conduct a data breach impact assessment under applicable data protection law. |
