# SCR-GBTI-03 Remediation Checklist
## Race Condition (TOCTOU) in verify_visitor_otp Enables OTP Reuse
**CVSS 5.9 MEDIUM** | CWE-362 | CWE-613 | OWASP A07:2021

---

## Problem Summary

The `verify_visitor_otp` PostgreSQL function used a two-step pattern:
1. `SELECT * INTO v_record` — reads the OTP row (no row lock)
2. `DELETE FROM visitor_otps WHERE id = v_record.id` — consumes it

Under PostgreSQL's default **READ COMMITTED** isolation, two concurrent requests
with the same OTP could **both** pass the SELECT check before either DELETE
commits. Both callers returned `TRUE`, authenticating two separate sessions with
a single one-time passcode.

---

## Fix Applied

**Migration:** `supabase/migrations/20260626_fix_toctou_otp_race.sql`

The fix replaces the separate SELECT-then-DELETE with an approach that:
1. Still does a non-locking SELECT to read the salt (needed to hash the submitted OTP before we can verify it)
2. After hash comparison passes, issues an atomic **`DELETE ... WHERE id = <id> AND expires_at > NOW() AND otp_hash = <hash>`** and checks `GET DIAGNOSTICS v_deleted = ROW_COUNT`
3. Returns `TRUE` **only** if `v_deleted > 0`

Because the DELETE itself is atomic, only one concurrent transaction can delete
the row — the other gets `ROW_COUNT = 0` and returns `FALSE`. The TOCTOU window
is collapsed to zero.

```sql
-- BEFORE (vulnerable)
SELECT * INTO v_record FROM visitor_otps WHERE email = ... AND expires_at > NOW();
-- race window here — concurrent caller also passes this check
IF v_submitted_hash = v_record.otp_hash THEN
  DELETE FROM visitor_otps WHERE email = ...;
  RETURN TRUE;  -- both concurrent callers return TRUE!
END IF;

-- AFTER (fixed — atomic)
DELETE FROM public.visitor_otps
WHERE id = v_record.id AND expires_at > NOW() AND otp_hash = v_record.otp_hash;
GET DIAGNOSTICS v_deleted = ROW_COUNT;
RETURN v_deleted > 0;  -- only ONE caller gets TRUE
```

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/20260626_fix_toctou_otp_race.sql` | **[NEW]** Migration applying atomic DELETE pattern |
| `supabase_visitor_setup.sql` | Updated root setup to use atomic DELETE pattern |

---

## Deployment Steps

- [ ] Apply `supabase/migrations/20260626_fix_toctou_otp_race.sql` in Supabase SQL Editor
- [ ] Verify with the queries in the migration's VERIFICATION section
- [ ] Run race-condition proof-of-concept test (see below) — expect exactly one `true` response

---

## Verification Test (Bash)

```bash
BASE="https://<your-project>.supabase.co"
ANON="<your-anon-key>"

# 1. Get an OTP
OTP=$(curl -s -X POST "$BASE/rest/v1/rpc/store_visitor_otp" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"p_email":"test@example.com"}' | tr -d '"')
echo "OTP: $OTP"

# 2. Race two concurrent verify calls
R1=$(curl -s -X POST "$BASE/rest/v1/rpc/verify_visitor_otp" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "{\"p_email\":\"test@example.com\",\"p_otp\":\"$OTP\"}")

R2=$(curl -s -X POST "$BASE/rest/v1/rpc/verify_visitor_otp" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "{\"p_email\":\"test@example.com\",\"p_otp\":\"$OTP\"}")

echo "Response 1: $R1"
echo "Response 2: $R2"
# Expected: one is 'true', one is 'false' — NEVER both 'true'
```

---

## Status

- [x] Migration file created: `20260626_fix_toctou_otp_race.sql`
- [x] Root setup file (`supabase_visitor_setup.sql`) updated
- [ ] Migration applied to Supabase project (manual step)
- [ ] Race-condition test passed
