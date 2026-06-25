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
      
      const supabaseApi = createClient(supabaseUrl, supabaseKey, {
        db: { schema: 'api' },
      });

      const { data: otpCode, error } = await supabaseApi.rpc('send_admin_login_otp', {
        p_email: email.trim().toLowerCase(),
      });

      if (error) {
        return new Response(JSON.stringify({ error: `RPC Error: ${error.message}` }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!otpCode) {
        return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (otpCode === 'RATE_LIMITED' || otpCode === 'LOCKED') {
        return new Response(JSON.stringify({ error: otpCode }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const INFOBIP_API_KEY = Deno.env.get('INFOBIP_API_KEY');
      const INFOBIP_BASE_URL = Deno.env.get('INFOBIP_BASE_URL');
      const INFOBIP_SENDER_EMAIL = Deno.env.get('INFOBIP_SENDER_EMAIL');
      const INFOBIP_SENDER_NAME = Deno.env.get('INFOBIP_SENDER_NAME') || 'GBTI Team';

      if (INFOBIP_API_KEY && INFOBIP_BASE_URL && INFOBIP_SENDER_EMAIL) {
        const form = new FormData();
        form.append('from', `${INFOBIP_SENDER_NAME} <${INFOBIP_SENDER_EMAIL}>`);
        form.append('to', email.trim().toLowerCase());
        form.append('subject', 'GBTI Admin — Login OTP');
        form.append('html', `
          <div style="font-family:Arial,sans-serif;color:#111;line-height:1.6;max-width:560px;margin:0 auto;padding:32px;">
            <h2 style="text-align:center;margin:0 0 8px;color:#111;font-size:20px;">Admin Login OTP</h2>
            <p style="text-align:center;color:#6b7280;margin:0 0 24px;font-size:14px;">Use the code below to sign in</p>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center;margin:0 0 24px;">
              <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#111;">${otpCode}</span>
            </div>
            <p style="text-align:center;color:#9ca3af;font-size:12px;margin:0;">Expires in 10 minutes.</p>
          </div>
        `);
        form.append('text', `Your GBTI Admin login OTP is: ${otpCode}\n\nExpires in 10 minutes.`);

        const res = await fetch(`${INFOBIP_BASE_URL}/email/3/send`, {
          method: 'POST',
          headers: { Authorization: `App ${INFOBIP_API_KEY}` },
          body: form,
        });

        if (!res.ok) {
           const body = await res.text();
           return new Response(JSON.stringify({ error: `Infobip Error: ${res.status} ${body}` }), {
             status: 200,
             headers: { ...corsHeaders, 'Content-Type': 'application/json' },
           });
        }
      } else {
         return new Response(JSON.stringify({ error: 'Infobip environment variables missing in edge function' }), {
           status: 200,
           headers: { ...corsHeaders, 'Content-Type': 'application/json' },
         });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
