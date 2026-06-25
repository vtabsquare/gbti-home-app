import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function verifyRecaptcha(token: string): Promise<boolean> {
  const secret = Deno.env.get('RECAPTCHA_SECRET_KEY') || '';
  if (!secret) throw new Error('RECAPTCHA_SECRET_KEY not configured');

  const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
  });

  const json = await res.json();
  // v3 returns a score (0.0 bot → 1.0 human); v2 just returns success boolean
  if (!json.success) return false;
  if (typeof json.score === 'number') return json.score >= 0.5;
  return true;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action, captchaToken, email } = await req.json();

    if (!captchaToken) {
      return new Response(JSON.stringify({ error: 'Missing CAPTCHA token' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const captchaValid = await verifyRecaptcha(captchaToken);
    if (!captchaValid) {
      return new Response(JSON.stringify({ error: 'CAPTCHA verification failed. Please try again.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // For visitor gate: just CAPTCHA verification is enough, frontend calls RPC directly
    if (action === 'verify_only') {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // For admin OTP: verify CAPTCHA then send OTP atomically
    if (action === 'send_admin_otp') {
      if (!email) {
        return new Response(JSON.stringify({ error: 'Missing email' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

      const { error } = await supabaseAdmin.rpc('send_admin_login_otp', {
        p_email: email.trim().toLowerCase(),
      });

      if (error) {
        return new Response(JSON.stringify({ error: 'Failed to send OTP' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
