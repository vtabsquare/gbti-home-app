# ============================================================
# GBTI-WEB-04: Unauthenticated PII Access Test
# CWE-200 / CWE-284 | OWASP A02:2021 | CVSS 7.5 HIGH
#
# Reproduces the exact test performed by Amber Cybereye:
#   Step 1 - Extract anon key from .env (same as JS bundle)
#   Step 2 - GET /rest/v1/leads         (53 customer PII records)
#   Step 3 - GET /rest/v1/visitor_sessions (77 fingerprint records)
#   Step 4 - Confirm total count via Prefer: count=exact header
#
# Usage:
#   .\test-pii-access-GBTI-WEB-04.ps1
# ============================================================

param([int]$SampleRows = 3)

# -- Load credentials from .env -----------------------------------------
$envFile = Join-Path $PSScriptRoot "..\\.env"
$SupabaseUrl = $null
$AnonKey     = $null

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*VITE_SUPABASE_URL\s*=\s*(.+)$')             { $SupabaseUrl = $Matches[1].Trim().Trim('"') }
        if ($_ -match '^\s*VITE_SUPABASE_PUBLISHABLE_KEY\s*=\s*(.+)$') { $AnonKey     = $Matches[1].Trim().Trim('"') }
    }
}

if (-not $SupabaseUrl -or -not $AnonKey) {
    Write-Host ""
    Write-Host "  [ERROR] Could not load credentials from .env" -ForegroundColor Red
    exit 1
}

$headers = @{
    "apikey"        = $AnonKey
    "Authorization" = "Bearer $AnonKey"
    "Prefer"        = "count=exact"
}

function Write-Section($title) {
    Write-Host ""
    Write-Host ("=" * 60) -ForegroundColor Cyan
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host ("=" * 60) -ForegroundColor Cyan
}

function Invoke-AnonGet($path) {
    try {
        $resp = Invoke-WebRequest -Uri "$SupabaseUrl/rest/v1/$path" `
            -Headers $headers -Method GET -UseBasicParsing -ErrorAction Stop
        return @{
            StatusCode    = $resp.StatusCode
            ContentRange  = $resp.Headers["Content-Range"]
            Body          = $resp.Content
        }
    } catch {
        $code = 0
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        $body = ""
        try { $body = $_.ErrorDetails.Message } catch {}
        return @{ StatusCode = $code; ContentRange = $null; Body = $body }
    }
}

# ============================================================
Write-Section "TEST 1 - leads table (53 Customer PII Records)"
# Amber's exact command:
# curl -s ".../rest/v1/leads" -H "apikey: <anon>" -H "Authorization: Bearer <anon>"
# ============================================================

Write-Host "  Endpoint  : $SupabaseUrl/rest/v1/leads"
Write-Host "  Key used  : anon (publicly available in JS bundle)"
Write-Host ""
Write-Host "  Sending unauthenticated GET request..." -ForegroundColor Yellow

$r1 = Invoke-AnonGet "leads?select=id,name,email,phone,total_cost&order=created_at.desc&limit=$SampleRows"

Write-Host ""
Write-Host "  HTTP Status    : $($r1.StatusCode)" -ForegroundColor $(if ($r1.StatusCode -eq 200) { "Red" } else { "Green" })
Write-Host "  Content-Range  : $($r1.ContentRange)" -ForegroundColor Yellow

if ($r1.StatusCode -ge 200 -and $r1.StatusCode -lt 300) {
    $rows = $null
    try { $rows = $r1.Body | ConvertFrom-Json } catch {}
    $count = if ($rows) { @($rows).Count } else { 0 }

    if ($count -gt 0) {
        $totalFromHeader = if ($r1.ContentRange -and $r1.ContentRange -match '/([0-9]+)') { $Matches[1] } else { "unknown" }
        Write-Host ""
        Write-Host "  [VULNERABLE] HTTP $($r1.StatusCode) -- $totalFromHeader total records readable by anon" -ForegroundColor Red
        Write-Host "  Showing $count sample rows. PII fields: name, email, phone, total_cost, config" -ForegroundColor Red
        Write-Host ""
        foreach ($row in $rows) {
            Write-Host "  -----------------------------------------------" -ForegroundColor DarkGray
            Write-Host "  name       : $($row.name)" -ForegroundColor Magenta
            Write-Host "  email      : $($row.email)" -ForegroundColor Magenta
            Write-Host "  phone      : $($row.phone)" -ForegroundColor Magenta
            Write-Host "  total_cost : $($row.total_cost)" -ForegroundColor Magenta
        }
    } else {
        Write-Host ""
        Write-Host "  [PROTECTED] HTTP $($r1.StatusCode) returned 0 rows (RLS blocking SELECT)." -ForegroundColor Green
    }
} else {
    Write-Host ""
    Write-Host "  [PROTECTED] Access denied ($($r1.StatusCode))." -ForegroundColor Green
    Write-Host "  $($r1.Body)" -ForegroundColor DarkGray
}

# ============================================================
Write-Section "TEST 2 - visitor_sessions table (77 Fingerprint Records)"
# Amber's exact command:
# curl -s ".../rest/v1/visitor_sessions" -H "apikey: <anon>" -H "Authorization: Bearer <anon>"
# ============================================================

Write-Host "  Endpoint  : $SupabaseUrl/rest/v1/visitor_sessions"
Write-Host "  Key used  : anon (publicly available in JS bundle)"
Write-Host ""
Write-Host "  Sending unauthenticated GET request..." -ForegroundColor Yellow

$r2 = Invoke-AnonGet "visitor_sessions?select=id,email,browser,os,screen_width,user_agent&order=created_at.desc&limit=$SampleRows"

Write-Host ""
Write-Host "  HTTP Status    : $($r2.StatusCode)" -ForegroundColor $(if ($r2.StatusCode -eq 200) { "Red" } else { "Green" })
Write-Host "  Content-Range  : $($r2.ContentRange)" -ForegroundColor Yellow

if ($r2.StatusCode -ge 200 -and $r2.StatusCode -lt 300) {
    $rows2 = $null
    try { $rows2 = $r2.Body | ConvertFrom-Json } catch {}
    $count2 = if ($rows2) { @($rows2).Count } else { 0 }

    if ($count2 -gt 0) {
        $totalFromHeader2 = if ($r2.ContentRange -and $r2.ContentRange -match '/([0-9]+)') { $Matches[1] } else { "unknown" }
        Write-Host ""
        Write-Host "  [VULNERABLE] HTTP $($r2.StatusCode) -- $totalFromHeader2 total records readable by anon" -ForegroundColor Red
        Write-Host "  Showing $count2 sample rows. PII fields: email, browser, os, screen_width, user_agent" -ForegroundColor Red
        Write-Host ""
        foreach ($row in $rows2) {
            Write-Host "  -----------------------------------------------" -ForegroundColor DarkGray
            Write-Host "  email       : $($row.email)" -ForegroundColor Magenta
            Write-Host "  browser     : $($row.browser)" -ForegroundColor Magenta
            Write-Host "  os          : $($row.os)" -ForegroundColor Magenta
            Write-Host "  screen_width: $($row.screen_width)" -ForegroundColor Magenta
            $ua = if ($row.user_agent) { ($row.user_agent.ToString()).Substring(0, [Math]::Min(80, $row.user_agent.ToString().Length)) + "..." } else { "(null)" }
            Write-Host "  user_agent  : $ua" -ForegroundColor Magenta
        }
    } else {
        Write-Host ""
        Write-Host "  [PROTECTED] HTTP $($r2.StatusCode) returned 0 rows (RLS blocking SELECT)." -ForegroundColor Green
    }
} else {
    Write-Host ""
    Write-Host "  [PROTECTED] Access denied ($($r2.StatusCode))." -ForegroundColor Green
    Write-Host "  $($r2.Body)" -ForegroundColor DarkGray
}

# ============================================================
Write-Section "SUMMARY - GBTI-WEB-04"
# ============================================================
Write-Host ""
Write-Host "  Finding  : Unauthenticated Access to Customer PII" -ForegroundColor White
Write-Host "  CVSS     : 7.5 HIGH (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N)" -ForegroundColor Red
Write-Host "  CWE      : CWE-200 (Info Disclosure) / CWE-284 (Access Control)" -ForegroundColor White
Write-Host "  OWASP    : A02:2021 - Cryptographic Failures" -ForegroundColor White
Write-Host ""

$leadsVuln   = ($r1.StatusCode -ge 200 -and $r1.StatusCode -lt 300) -and ($r1.Body.Length -gt 5) -and ($r1.Body -ne "[]")
$sessVuln    = ($r2.StatusCode -ge 200 -and $r2.StatusCode -lt 300) -and ($r2.Body.Length -gt 5) -and ($r2.Body -ne "[]")

$s1 = if ($leadsVuln) { "[VULNERABLE]" } else { "[PROTECTED]" }
$s2 = if ($sessVuln)  { "[VULNERABLE]" } else { "[PROTECTED]" }
$c1 = if ($leadsVuln) { "Red" } else { "Green" }
$c2 = if ($sessVuln)  { "Red" } else { "Green" }

Write-Host "  Test 1 (leads table)           : $s1" -ForegroundColor $c1
Write-Host "  Test 2 (visitor_sessions table): $s2" -ForegroundColor $c2
Write-Host ""

if ($leadsVuln -or $sessVuln) {
    Write-Host "  REMEDIATION:" -ForegroundColor Yellow
    Write-Host "  1. Run supabase/migrations/20260624_pii_rls_fix.sql in Supabase SQL Editor" -ForegroundColor White
    Write-Host "  2. Verify: DROP POLICY 'Admin can read leads' ON public.leads;" -ForegroundColor White
    Write-Host "  3. Verify: visitor_sessions has RLS enabled with no anon SELECT policy" -ForegroundColor White
} else {
    Write-Host "  Both tables are protected. GBTI-WEB-04 remediated." -ForegroundColor Green
}
Write-Host ""
