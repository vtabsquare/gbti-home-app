# ============================================================
# GBTI-WEB-06: Database Schema Disclosure via PostgREST Hints
# CWE-209 | OWASP A05:2021 | CVSS 5.3 MEDIUM
#
# Reproduces Amber Cybereye's exact test:
#   curl -s ".../rest/v1/users"     -H "apikey: <anon>"
#   --> {"code":"PGRST205","hint":"Perhaps you meant the table 'public.admin_users'",...}
#
# Before fix: hints reveal internal table names (admin_users, visitor_otps, etc.)
# After fix:  Supabase exposed schema changed to 'api' (functions only, no tables)
#             PGRST205 hints no longer reveal any table names.
#
# Usage:  .\test-schema-disclosure-GBTI-WEB-06.ps1
# ============================================================

# -- Load credentials ---------------------------------------------------
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
    Write-Host "[ERROR] Could not load credentials from .env" -ForegroundColor Red; exit 1
}

$headers = @{ "apikey" = $AnonKey; "Authorization" = "Bearer $AnonKey" }

function Write-Section($t) {
    Write-Host ""
    Write-Host ("=" * 64) -ForegroundColor Cyan
    Write-Host "  $t" -ForegroundColor Cyan
    Write-Host ("=" * 64) -ForegroundColor Cyan
}

function Probe-Table($guessName) {
    try {
        $r = Invoke-WebRequest -Uri "$SupabaseUrl/rest/v1/$guessName" `
            -Headers $headers -Method GET -UseBasicParsing -ErrorAction Stop
        return @{ Status = $r.StatusCode; Body = $r.Content }
    } catch {
        $code = 0
        $body = ""
        if ($_.Exception.Response) {
            $code = [int]$_.Exception.Response.StatusCode
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $body   = $reader.ReadToEnd()
                $reader.Dispose()
            } catch {}
        }
        if (-not $body) { try { $body = $_.ErrorDetails.Message } catch {} }
        return @{ Status = $code; Body = $body }
    }
}

function Extract-Hint($body) {
    try {
        $j = $body | ConvertFrom-Json
        return $j.hint
    } catch { return $null }
}

# ── Amber's exact probes ───────────────────────────────────────────────
$probes = @(
    @{ Guess = "users";     Expected = "admin_users" },
    @{ Guess = "customers"; Expected = "visitor_otps" },
    @{ Guess = "profiles";  Expected = "attorney_profiles" },
    @{ Guess = "sessions";  Expected = "visitor_sessions" },
    @{ Guess = "settings";  Expected = "admin_settings" },
    @{ Guess = "rules";     Expected = "fee_rules" }
)

Write-Section "TEST - Schema Enumeration via PGRST205 Hints"
Write-Host "  Method : GET /rest/v1/{non_existent_table} with anon key"
Write-Host "  Goal   : Check if hints reveal internal table names"
Write-Host ""

$vulnerableCount = 0
$results = @()

foreach ($probe in $probes) {
    $resp = Probe-Table $probe.Guess
    $hint = Extract-Hint $resp.Body

    $disclosed = $hint -ne $null -and $hint -ne ""
    if ($disclosed) { $vulnerableCount++ }

    $status = if ($disclosed) { "[LEAKS SCHEMA]" } else { "[NO HINT]" }
    $color  = if ($disclosed) { "Red" } else { "Green" }

    Write-Host ("  GET /rest/v1/{0,-12}  HTTP {1}  {2}" -f $probe.Guess, $resp.Status, $status) -ForegroundColor $color
    if ($disclosed) {
        Write-Host ("    hint: {0}" -f $hint) -ForegroundColor Magenta
    }
    $results += @{ Guess = $probe.Guess; Hint = $hint; Vulnerable = $disclosed }
}

# ── Summary ─────────────────────────────────────────────────────────────
Write-Section "SUMMARY - GBTI-WEB-06"
Write-Host ""
Write-Host "  Finding  : Database Schema Disclosure via PostgREST API Error Messages" -ForegroundColor White
Write-Host "  CVSS     : 5.3 MEDIUM (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N)" -ForegroundColor Yellow
Write-Host "  CWE      : CWE-209 (Error Message Containing Sensitive Information)" -ForegroundColor White
Write-Host "  OWASP    : A05:2021 - Security Misconfiguration" -ForegroundColor White
Write-Host ""

if ($vulnerableCount -gt 0) {
    Write-Host ("  [VULNERABLE] {0}/{1} probes returned schema hints" -f $vulnerableCount, $probes.Count) -ForegroundColor Red
    Write-Host ""
    Write-Host "  REMEDIATION STEPS:" -ForegroundColor Yellow
    Write-Host "  1. Apply SQL migration: supabase/migrations/20260624_schema_disclosure_fix.sql" -ForegroundColor White
    Write-Host "  2. Supabase Dashboard -> Settings -> API -> Exposed Schemas:" -ForegroundColor White
    Write-Host "     Change from 'public' to 'api'" -ForegroundColor White
    Write-Host "  3. Re-run this script to confirm [NO HINT] for all probes." -ForegroundColor White
} else {
    Write-Host "  [PROTECTED] 0/$($probes.Count) probes returned schema hints." -ForegroundColor Green
    Write-Host "  GBTI-WEB-06 remediated -- PostgREST no longer leaks table names." -ForegroundColor Green
}
Write-Host ""
