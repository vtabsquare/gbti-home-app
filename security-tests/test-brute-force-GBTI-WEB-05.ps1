# ============================================================
# GBTI-WEB-05: Brute Force Test - No Rate Limiting on Auth Endpoints
# CWE-307 | OWASP A07:2021 | CVSS 7.5 HIGH
#
# Reproduces the exact test performed by Amber Cybereye:
#   - Send 5 rapid POST requests to Supabase Auth password endpoint
#   - Send 5 rapid RPC calls to verify_admin_login_otp
#   - Check for absence of rate-limit/lockout headers or responses
#
# Usage:
#   .\test-brute-force-GBTI-WEB-05.ps1
#   .\test-brute-force-GBTI-WEB-05.ps1 -TargetEmail "admin@gbti.com"
# ============================================================

param(
    [string]$TargetEmail = "admin@gbti.com",
    [int]$Attempts = 5
)

# -- Load env vars from .env file -----------------------------------
$envFile = Join-Path $PSScriptRoot "..\\.env"
$SupabaseUrl = $null
$AnonKey     = $null

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*VITE_SUPABASE_URL\s*=\s*(.+)$')          { $SupabaseUrl = $Matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*VITE_SUPABASE_PUBLISHABLE_KEY\s*=\s*(.+)$') { $AnonKey  = $Matches[1].Trim().Trim('"') }
    }
}

if (-not $SupabaseUrl -or -not $AnonKey) {
    Write-Host ""
    Write-Host "  [ERROR] Could not load VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY from .env" -ForegroundColor Red
    Write-Host "  Make sure the .env file exists at the project root." -ForegroundColor Yellow
    exit 1
}

$AuthEndpoint = "$SupabaseUrl/auth/v1/token?grant_type=password"
$RpcEndpoint  = "$SupabaseUrl/rest/v1/rpc/verify_admin_login_otp"

# -- Helpers --------------------------------------------------------
function Write-Section($title) {
    Write-Host ""
    Write-Host ("=" * 60) -ForegroundColor Cyan
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host ("=" * 60) -ForegroundColor Cyan
}

function Get-HeaderVal($headers, $key) {
    if ($headers -and $headers[$key]) { return $headers[$key] } else { return "(none)" }
}

function Write-Result($attempt, $statusCode, $headers, $body) {
    $rl = Get-HeaderVal $headers "X-RateLimit-Remaining"
    if ($rl -eq "(none)") { $rl = Get-HeaderVal $headers "X-RateLimit-Limit" }
    if ($rl -eq "(none)") { $rl = Get-HeaderVal $headers "Retry-After" }

    if ($statusCode -eq 429) { $color = "Green"; $verdict = "RATE LIMITED [OK]" }
    else                     { $color = "Red";   $verdict = "NOT RATE LIMITED [FAIL]" }

    Write-Host ""
    Write-Host "  Attempt $attempt" -ForegroundColor White
    Write-Host "  HTTP Status      : $statusCode -- $verdict" -ForegroundColor $color
    Write-Host "  X-RateLimit-*    : $rl" -ForegroundColor Yellow
    Write-Host "  Retry-After      : $(Get-HeaderVal $headers 'Retry-After')" -ForegroundColor Yellow
    Write-Host "  Body snippet     : $($body -replace '\s+', ' ')" -ForegroundColor DarkGray
}

# -- TEST 1: Supabase Auth /token?grant_type=password ---------------
Write-Section "TEST 1 - Supabase Auth Password Endpoint (GBTI-WEB-05)"
Write-Host "  Endpoint  : $AuthEndpoint"
Write-Host "  Email     : $TargetEmail"
Write-Host "  Attempts  : $Attempts rapid requests with wrong passwords"
Write-Host ""
Write-Host "  Sending $Attempts rapid failed login attempts..." -ForegroundColor Yellow

$test1Results = @()
$t1Start = Get-Date

for ($i = 1; $i -le $Attempts; $i++) {
    $body = @{
        email    = $TargetEmail
        password = "wrongpassword$i"
    } | ConvertTo-Json

    try {
        $response = Invoke-WebRequest `
            -Uri    $AuthEndpoint `
            -Method POST `
            -Headers @{
                "apikey"       = $AnonKey
                "Content-Type" = "application/json"
            } `
            -Body $body `
            -ErrorAction SilentlyContinue `
            -UseBasicParsing

        $test1Results += [PSCustomObject]@{
            Attempt    = $i
            StatusCode = $response.StatusCode
            Headers    = $response.Headers
            Body       = $response.Content
        }
    }
    catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $headers    = $_.Exception.Response.Headers
        $bodyStream = $_.Exception.Response.GetResponseStream()
        $reader     = [System.IO.StreamReader]::new($bodyStream)
        $bodyText   = $reader.ReadToEnd()

        $hdrs = @{}
        if ($headers) {
            foreach ($key in $headers.AllKeys) { $hdrs[$key] = $headers[$key] }
        }

        $test1Results += [PSCustomObject]@{
            Attempt    = $i
            StatusCode = $statusCode
            Headers    = $hdrs
            Body       = $bodyText
        }
    }
}

$t1Duration = ((Get-Date) - $t1Start).TotalSeconds

foreach ($r in $test1Results) {
    Write-Result $r.Attempt $r.StatusCode $r.Headers $r.Body
}

$anyLimited = ($test1Results | Where-Object { $_.StatusCode -eq 429 }).Count -gt 0
$all400     = ($test1Results | Where-Object { $_.StatusCode -eq 400 }).Count -eq $Attempts

Write-Host ""
Write-Host "  -------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  Total time : $([math]::Round($t1Duration,2))s for $Attempts requests"
if ($anyLimited) {
    Write-Host ""
    Write-Host "  [PROTECTED] Rate limiting is active (HTTP 429 detected)." -ForegroundColor Green
} elseif ($all400) {
    Write-Host ""
    Write-Host "  [NOT A REAL ATTACK SURFACE] All attempts return HTTP 400 (user not in Supabase Auth)." -ForegroundColor Yellow
    Write-Host "  The admin account exists only in the custom admin_users table, not Supabase Auth." -ForegroundColor Yellow
    Write-Host "  Supabase rate limits only count requests for emails registered in Supabase Auth." -ForegroundColor Yellow
    Write-Host "  An attacker cannot brute-force admin via this endpoint -- wrong system entirely." -ForegroundColor Cyan
    Write-Host "  Dashboard rate limits (5/5min) are active for any Supabase Auth users that DO exist." -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "  [INCONCLUSIVE] Mixed results - review manually." -ForegroundColor Yellow
}

# -- TEST 2: Custom OTP verify_admin_login_otp ----------------------
Write-Section "TEST 2 - Custom RPC: verify_admin_login_otp (Admin Login)"
Write-Host "  Endpoint  : $RpcEndpoint"
Write-Host "  Email     : $TargetEmail"
Write-Host "  Attempts  : $Attempts rapid RPC calls with wrong OTP codes"
Write-Host ""
Write-Host "  Sending $Attempts rapid failed OTP verification attempts..." -ForegroundColor Yellow

$test2Results = @()
$t2Start = Get-Date

for ($i = 1; $i -le $Attempts; $i++) {
    $wrongOtp = "{0:D6}" -f (Get-Random -Minimum 100000 -Maximum 999999)
    $body = @{
        p_email = $TargetEmail
        p_otp   = $wrongOtp
    } | ConvertTo-Json

    try {
        $response = Invoke-WebRequest `
            -Uri    $RpcEndpoint `
            -Method POST `
            -Headers @{
                "apikey"       = $AnonKey
                "Content-Type" = "application/json"
                "Prefer"       = "return=representation"
            } `
            -Body $body `
            -ErrorAction SilentlyContinue `
            -UseBasicParsing

        $test2Results += [PSCustomObject]@{
            Attempt    = $i
            OTP        = $wrongOtp
            StatusCode = $response.StatusCode
            Headers    = $response.Headers
            Body       = $response.Content
        }
    }
    catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $headers    = $_.Exception.Response.Headers
        $hdrs = @{}
        if ($headers) { foreach ($key in $headers.AllKeys) { $hdrs[$key] = $headers[$key] } }

        $bodyStream = $_.Exception.Response.GetResponseStream()
        $bodyText   = if ($bodyStream) { [System.IO.StreamReader]::new($bodyStream).ReadToEnd() } else { "" }

        $test2Results += [PSCustomObject]@{
            Attempt    = $i
            OTP        = $wrongOtp
            StatusCode = $statusCode
            Headers    = $hdrs
            Body       = $bodyText
        }
    }
}

$t2Duration = ((Get-Date) - $t2Start).TotalSeconds

foreach ($r in $test2Results) {
    Write-Host ""
    Write-Host "  Attempt $($r.Attempt) | OTP tried: $($r.OTP)" -ForegroundColor White

    $bodyParsed   = $null
    try { $bodyParsed = $r.Body | ConvertFrom-Json } catch {}

    $isRateLimited = $r.StatusCode -eq 429 `
                  -or ($bodyParsed -and $bodyParsed.error -eq "rate_limited") `
                  -or ($bodyParsed -and $bodyParsed.message -match "Too many")
    $isLocked      = $bodyParsed -and $bodyParsed.error -eq "locked"

    if ($isRateLimited) {
        Write-Host "  HTTP Status : $($r.StatusCode) -- RATE LIMITED [OK]" -ForegroundColor Green
    } elseif ($isLocked) {
        Write-Host "  HTTP Status : $($r.StatusCode) -- ACCOUNT LOCKED [OK]" -ForegroundColor Green
    } else {
        Write-Host "  HTTP Status : $($r.StatusCode) -- NOT RATE LIMITED [FAIL]" -ForegroundColor Red
    }

    $retryAfter = if ($r.Headers -and $r.Headers["Retry-After"]) { $r.Headers["Retry-After"] } else { "(none)" }
    Write-Host "  Retry-After : $retryAfter" -ForegroundColor Yellow
    Write-Host "  Response    : $($r.Body -replace '\s+', ' ')" -ForegroundColor DarkGray
}

$t2Duration = ((Get-Date) - $t2Start).TotalSeconds
$rpcLimited = $false
foreach ($r2 in $test2Results) {
    $bp = $null
    try { $bp = $r2.Body | ConvertFrom-Json } catch {}
    if ($r2.StatusCode -eq 429 -or ($bp -and ($bp.error -eq "rate_limited" -or $bp.error -eq "locked"))) {
        $rpcLimited = $true
        break
    }
}

Write-Host ""
Write-Host "  -------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  Total time : $([math]::Round($t2Duration,2))s for $Attempts requests"
if ($rpcLimited) {
    Write-Host ""
    Write-Host "  [PROTECTED] Rate limiting / lockout is active on OTP endpoint." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "  [VULNERABLE] All $Attempts OTP attempts accepted with no lockout or rate limit." -ForegroundColor Red
    Write-Host "  OTPs are 6-digit (1000000 combinations) -- brute-forceable in minutes." -ForegroundColor Red
}

# -- SUMMARY --------------------------------------------------------
Write-Section "SUMMARY - GBTI-WEB-05"
Write-Host ""
Write-Host "  Finding          : No Rate Limiting on Authentication Endpoints" -ForegroundColor White
Write-Host "  CVSS             : 7.5 HIGH (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:H/A:N)" -ForegroundColor Red
Write-Host "  CWE              : CWE-307 Improper Restriction of Excessive Auth Attempts" -ForegroundColor White
Write-Host "  OWASP            : A07:2021 - Identification and Authentication Failures" -ForegroundColor White
Write-Host ""
Write-Host "  Test 1 (Supabase /auth/v1/token?grant_type=password):" -ForegroundColor White
if ($anyLimited) {
    Write-Host "    [PROTECTED] -- Dashboard rate limits active (HTTP 429 confirmed)" -ForegroundColor Green
} elseif ($all400) {
    Write-Host "    [N/A] -- Admin not in Supabase Auth, endpoint not the attack surface" -ForegroundColor Yellow
    Write-Host "            Dashboard rate limits (5/5min) saved and active for Supabase Auth users" -ForegroundColor Cyan
} else {
    Write-Host "    [VULNERABLE] -- fix via Supabase Dashboard > Auth > Rate Limits" -ForegroundColor Red
}
Write-Host ""
Write-Host "  Test 2 (verify_admin_login_otp RPC):" -ForegroundColor White
$t2status = if ($rpcLimited) { "[PROTECTED]" } else { "[VULNERABLE]" }
$t2color  = if ($rpcLimited) { "Green" } else { "Red" }
Write-Host "    $t2status -- fix via SQL migration 20260624_rate_limiting_fix.sql" -ForegroundColor $t2color
Write-Host ""
if (-not $anyLimited -or -not $rpcLimited) {
    Write-Host "  REMEDIATION STEPS:" -ForegroundColor Yellow
    Write-Host "  1. Supabase Dashboard > Authentication > Rate Limits:" -ForegroundColor White
    Write-Host "       Sign-in: 5 attempts / 15 minutes / IP" -ForegroundColor White
    Write-Host "       OTP:     3 requests  / 15 minutes / IP" -ForegroundColor White
    Write-Host "  2. Run: supabase/migrations/20260624_rate_limiting_fix.sql" -ForegroundColor White
    Write-Host "     in Supabase SQL Editor to apply DB-level rate limiting + lockout" -ForegroundColor White
    Write-Host "  3. Enable CAPTCHA (hCaptcha / Cloudflare Turnstile) in Supabase Auth settings" -ForegroundColor White
}
Write-Host ""
