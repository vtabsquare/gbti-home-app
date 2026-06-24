# GBTI-WEB-05 Remediation Checklist
**Finding**: No Rate Limiting on Authentication Endpoints Led to Brute Force Attack  
**CVSS**: 7.5 HIGH | CWE-307 | OWASP A07:2021

---

## Fix A — Database Rate Limiting (SQL Migration)
**File**: `supabase/migrations/20260624_rate_limiting_fix.sql`

Apply in **Supabase Dashboard > SQL Editor**:

- [x] `auth_rate_limits` table created (sliding-window attempt log)
- [x] `is_rate_limited()` helper function
- [x] `record_auth_attempt()` helper function
- [x] `send_admin_login_otp()` — max **3 OTP requests / 15 min / email**
- [x] `verify_admin_login_otp()` — max **5 verify attempts / 15 min / email** + **account lockout after 10 failures (30 min)**
- [x] `store_visitor_otp()` — max **3 OTP requests / 15 min / email**
- [x] `verify_visitor_otp()` — max **5 verify attempts / 15 min / email**
- [x] `failed_otp_attempts` + `locked_until` columns added to `admin_users`

Status: [ ] Pending / [ ] Applied

---

## Fix B — Supabase Dashboard Rate Limits (Auth Settings)
**Location**: Supabase Dashboard > Authentication > Rate Limits

| Endpoint                | Setting                         | Recommended Value         |
|-------------------------|---------------------------------|---------------------------|
| Sign-in (password)      | Max requests per hour           | **5 per 15 min per IP**   |
| OTP / Magic link send   | Max requests per hour           | **3 per 15 min per IP**   |
| Password recovery       | Max requests per hour           | **3 per 15 min per IP**   |

Status: [ ] Pending / [ ] Applied

---

## Fix C — CAPTCHA Protection (Supabase Auth Settings)
**Location**: Supabase Dashboard > Authentication > Providers > CAPTCHA Protection

- Enable **Cloudflare Turnstile** or **hCaptcha**
- Applies to: sign-in, OTP request, password recovery endpoints
- Supabase natively supports both — no code changes required

Status: [ ] Pending / [ ] Applied

---

## Verification
Run after applying all fixes:
```powershell
powershell -ExecutionPolicy Bypass -File security-tests\test-brute-force-GBTI-WEB-05.ps1
```

Expected results after fix:
- Test 1 (Supabase auth endpoint): HTTP 429 on attempt 6+ OR CAPTCHA challenge
- Test 2 (verify_admin_login_otp): `rate_limited` error on attempt 6+ within 15 min window
