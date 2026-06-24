# GBTI-WEB-06 Remediation Checklist
## Database Schema Disclosure via PostgREST API Error Messages

| Field | Value |
|---|---|
| **CVSS** | 5.3 MEDIUM — CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N |
| **CWE** | CWE-209 (Error Message Containing Sensitive Information) |
| **OWASP** | A05:2021 – Security Misconfiguration |
| **Status** | Code complete — awaiting Supabase Dashboard configuration (Step 3) |

---

## Root Cause

PostgREST returns a `PGRST205` hint when a non-existent table is queried:

```
GET /rest/v1/users  →  {"code":"PGRST205","hint":"Perhaps you meant the table 'public.admin_users'"}
GET /rest/v1/customers  →  hint: "public.visitor_otps"
GET /rest/v1/profiles  →  hint: "public.attorney_profiles"
```

By iterating through common names, an attacker can enumerate the full schema without any
prior knowledge or authenticated access. This accelerated GBTI-WEB-04 exploitation
(knowing `admin_users` exists enables targeted attacks even before RLS bypass).

---

## Three-Part Fix

### Step 1 — Apply SQL Migration ✅ Code Complete

**File:** `supabase/migrations/20260624_schema_disclosure_fix.sql`

Run in **Supabase Dashboard → SQL Editor**.

What it does:
- Creates `api` schema (functions only — no tables)
- Creates `SECURITY DEFINER` wrapper functions in `api` for every operation the anon role needs:
  - `api.submit_lead(...)` — replaces direct `INSERT INTO leads`
  - `api.update_lead_config(id, config)` — replaces direct `UPDATE leads`
  - `api.get_presets()` / `api.save_preset()` / `api.update_preset()` / `api.delete_preset()`
  - `api.get_package_layouts()` / `api.upsert_package_layout()`
  - `api.get_pricing()` / `api.get_mortgage_settings()`
  - `api.store_visitor_otp()` / `api.verify_visitor_otp()` / `api.store_visitor_session()`
  - `api.send_admin_login_otp()` / `api.verify_admin_login_otp()` / `api.verify_admin_session()`
- Grants `EXECUTE` on all `api.*` to `anon` and `authenticated`
- **Does NOT** drop existing `public` policies yet (zero-downtime approach)

---

### Step 2 — Deploy Updated Frontend ✅ Code Complete

All direct `supabase.from('table')` calls in the main app have been replaced with
`supabase.rpc('function_name', {...})` targeting the `api` schema:

| File | Change |
|---|---|
| `src/components/configurator/steps/StepLeadCapture.tsx` | `from('leads').insert/update` → `rpc('submit_lead')` / `rpc('update_lead_config')` |
| `src/store/configurator.ts` | `from('presets'/*`)` → `rpc('get/save/update/delete_preset')` |
| `src/store/configurator.ts` | `from('package_layouts'/**)` → `rpc('get/upsert_package_layout')` |
| `src/hooks/useMortgageCalculator.ts` | `from('mortgage_settings')` → `rpc('get_mortgage_settings')` |
| `src/hooks/useMortgageCalculator.ts` | `from('admin_settings')` → `rpc('get_pricing')` |

---

### Step 3 — Change Supabase Exposed Schema ⚠️ MANUAL STEP REQUIRED

**This is the step that actually stops PGRST205 from leaking table names.**

1. Open **Supabase Dashboard → Settings → API**
2. Find **"Exposed schemas"** (currently shows `public`)
3. Change to: `api`  ← remove `public`, add `api`
4. Save / restart PostgREST

**After this change:**
- `GET /rest/v1/users` → PGRST205 hints now search `api` schema only
- `api` schema contains only functions (not tables)
- PostgREST has nothing to suggest → hint field is empty or absent
- Schema enumeration attack is neutralised

**Why this is safe:**
- All anon operations use `supabase.rpc('function_name')` → calls `POST /rest/v1/rpc/function_name`
- PostgREST finds these in `api` schema ✓
- Admin dashboard uses Edge Function (service role) — unaffected
- Tables remain in `public` and are accessed by SECURITY DEFINER functions

---

### Step 4 — Drop Redundant Direct Policies (Optional Cleanup)

Once Step 3 is verified working, run this in SQL Editor to remove stale policies:

```sql
DROP POLICY IF EXISTS "Public can insert leads"           ON public.leads;
DROP POLICY IF EXISTS "Anyone can read package layouts"   ON public.package_layouts;
DROP POLICY IF EXISTS "Anyone can upsert package layouts" ON public.package_layouts;
DROP POLICY IF EXISTS "Anyone can update package layouts" ON public.package_layouts;
DROP POLICY IF EXISTS "Public can read presets"           ON public.presets;
DROP POLICY IF EXISTS "Anyone can read mortgage settings" ON public.mortgage_settings;
DROP POLICY IF EXISTS "Anyone can read fee rules"         ON public.fee_rules;
```

---

## Verification

Run test script before and after Step 3:

```powershell
.\security-tests\test-schema-disclosure-GBTI-WEB-06.ps1
```

**Before Step 3:** Shows `[LEAKS SCHEMA]` with table names in hints  
**After Step 3:** Shows `[NO HINT]` for all probes — `GBTI-WEB-06 remediated`

---

## What Amber's Exact PoC Returns After Fix

```
GET /rest/v1/users      →  {"code":"PGRST205","hint":null,"message":"Could not find 'api.users'"}
GET /rest/v1/customers  →  {"code":"PGRST205","hint":null,"message":"Could not find 'api.customers'"}
```

No table names disclosed. Reconnaissance phase blocked.
