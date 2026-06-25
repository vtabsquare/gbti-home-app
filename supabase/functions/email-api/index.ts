import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token',
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
  if (!json.success) return false;
  if (typeof json.score === 'number') return json.score >= 0.5;
  return true;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

    const INFOBIP_API_KEY = Deno.env.get('INFOBIP_API_KEY');
    const INFOBIP_BASE_URL = Deno.env.get('INFOBIP_BASE_URL');
    const INFOBIP_SENDER_EMAIL = Deno.env.get('INFOBIP_SENDER_EMAIL');
    const INFOBIP_SENDER_NAME = Deno.env.get('INFOBIP_SENDER_NAME') || 'GBTI Team';

    if (!INFOBIP_API_KEY || !INFOBIP_BASE_URL || !INFOBIP_SENDER_EMAIL) {
      throw new Error('Email API is not fully configured on the server.');
    }

    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const action = formData.get('action');

      if (action === 'send_lead_estimate') {
        const toName = formData.get('toName') as string;
        const toEmail = formData.get('toEmail') as string;
        const subject = formData.get('subject') as string;
        const html = formData.get('html') as string;
        const text = formData.get('text') as string;
        const attachment = formData.get('attachment') as File | null;

        const infobipForm = new FormData();
        infobipForm.append('from', `${INFOBIP_SENDER_NAME} <${INFOBIP_SENDER_EMAIL}>`);
        infobipForm.append('to', `${toName} <${toEmail}>`);
        infobipForm.append('subject', subject);
        infobipForm.append('html', html);
        infobipForm.append('text', text);
        
        if (attachment) {
          infobipForm.append('attachment', attachment, attachment.name || 'Estimate.pdf');
        }

        const response = await fetch(`${INFOBIP_BASE_URL}/email/3/send`, {
          method: 'POST',
          headers: { Authorization: `App ${INFOBIP_API_KEY}` },
          body: infobipForm,
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Email provider error: ${errText}`);
        }

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      throw new Error('Unknown form action');
    } 
    
    const body = await req.json();
    const action = body.action;

    if (action === 'send_admin_bulk_email') {
      const sessionToken = req.headers.get('x-session-token');
      if (!sessionToken) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Missing session token' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { data: isValid, error: verifyError } = await supabaseAdmin.rpc('verify_admin_session', { p_token: sessionToken });
      
      if (verifyError || !isValid) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Invalid or expired session' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { toName, toEmail, subject, html, text } = body;

      const infobipForm = new FormData();
      infobipForm.append('from', `${INFOBIP_SENDER_NAME} <${INFOBIP_SENDER_EMAIL}>`);
      infobipForm.append('to', `${toName} <${toEmail}>`);
      infobipForm.append('subject', subject);
      infobipForm.append('html', html);
      infobipForm.append('text', text);

      const response = await fetch(`${INFOBIP_BASE_URL}/email/3/send`, {
        method: 'POST',
        headers: { Authorization: `App ${INFOBIP_API_KEY}` },
        body: infobipForm,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Email provider error: ${errText}`);
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'send_admin_reset_otp') {
      const toEmail = formData.get('toEmail') as string;
      if (!toEmail) throw new Error('Missing email');

      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
      const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

      const { data: otpCode, error } = await supabaseAdmin.rpc('generate_admin_reset_code', {
        p_email: toEmail.trim().toLowerCase(),
      });

      if (error || !otpCode) throw new Error('Failed to generate reset code');

      const form = new FormData();
      form.append('from', `${INFOBIP_SENDER_NAME} <${INFOBIP_SENDER_EMAIL}>`);
      form.append('to', toEmail.trim());
      form.append('subject', 'GBTI Admin — Password Reset Code');
      form.append('html', `
        <div style="font-family:Arial,sans-serif;color:#111;line-height:1.6;max-width:560px;margin:0 auto;padding:32px;">
          <h2 style="text-align:center;margin:0 0 8px;color:#111;font-size:20px;">Password Reset Code</h2>
          <p style="text-align:center;color:#6b7280;margin:0 0 24px;font-size:14px;">Use the code below to reset your GBTI Admin password</p>
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center;margin:0 0 24px;">
            <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#111;">${otpCode}</span>
          </div>
          <p style="text-align:center;color:#9ca3af;font-size:12px;margin:0;">Expires in 15 minutes.</p>
        </div>
      `);
      form.append('text', `Your GBTI Admin password reset code is: ${otpCode}\n\nExpires in 15 minutes.`);

      const infobipResponse = await fetch(`${INFOBIP_BASE_URL}/email/3/send`, {
        method: 'POST',
        headers: { Authorization: `App ${INFOBIP_API_KEY}` },
        body: form,
      });

      if (!infobipResponse.ok) throw new Error('Infobip request failed');

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'send_admin_welcome') {
      const toEmail = formData.get('toEmail') as string;
      const adminUrl = formData.get('adminUrl') as string || 'the admin dashboard';
      if (!toEmail) throw new Error('Missing email');

      const form = new FormData();
      form.append('from', `${INFOBIP_SENDER_NAME} <${INFOBIP_SENDER_EMAIL}>`);
      form.append('to', toEmail.trim());
      form.append('subject', 'Welcome to GBTI Admin');
      form.append('html', `
        <div style="font-family:Arial,sans-serif;color:#111;line-height:1.6;max-width:560px;margin:0 auto;padding:32px;">
          <h2 style="margin:0 0 16px;color:#111;font-size:24px;">Welcome to GBTI Admin</h2>
          <p style="margin:0 0 16px;">An admin account has been created for you.</p>
          <p style="margin:0 0 16px;"><strong>Login Email:</strong> ${toEmail}</p>
          <p style="margin:0 0 24px;">To sign in, visit <a href="${adminUrl}" style="color:#b8956a;text-decoration:none;">${adminUrl}</a> and enter your email. A one-time login code (OTP) will be sent to this address each time you log in.</p>
          <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;"/>
          <p style="font-size:12px;color:#9ca3af;margin:0;">GBTI Architectural Team</p>
        </div>
      `);
      form.append('text', `Welcome to GBTI Admin!\n\nAn admin account has been created for you.\n\nYour login email: ${toEmail}\n\nTo sign in, visit ${adminUrl} and enter your email. A one-time login code (OTP) will be sent each time you log in.\n\n-- GBTI Architectural Team`);

      const infobipResponse = await fetch(`${INFOBIP_BASE_URL}/email/3/send`, {
        method: 'POST',
        headers: { Authorization: `App ${INFOBIP_API_KEY}` },
        body: form,
      });

      if (!infobipResponse.ok) throw new Error('Infobip request failed');

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
