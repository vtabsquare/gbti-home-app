import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.0';

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token',
};

type BulkEmailPayload = {
  recipients: Array<{ email: string; name: string }>;
  subject: string;
  htmlContent: string;
  textContent: string;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // --- Auth: verify admin session token ---
    const sessionToken = req.headers.get('x-session-token');
    if (!sessionToken) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Missing session token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Server configuration missing');
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseKey);
    const { data: isValid, error: verifyError } = await supabaseAdmin.rpc('verify_admin_session', {
      p_token: sessionToken,
    });

    if (verifyError || !isValid) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- Infobip credentials read server-side only ---
    const infobipApiKey = Deno.env.get('INFOBIP_API_KEY');
    const infobipBaseUrl = Deno.env.get('INFOBIP_BASE_URL');
    const infobipSenderEmail = Deno.env.get('INFOBIP_SENDER_EMAIL');
    const infobipSenderName = Deno.env.get('INFOBIP_SENDER_NAME') || 'GBTI Architectural Team';

    if (!infobipApiKey || !infobipBaseUrl || !infobipSenderEmail) {
      return new Response(JSON.stringify({ error: 'Infobip API is not configured on the server' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json() as BulkEmailPayload;
    const { recipients, subject, htmlContent, textContent } = body;

    if (!recipients?.length || !subject || !htmlContent) {
      return new Response(JSON.stringify({ error: 'Invalid payload: recipients, subject, and htmlContent are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // --- Send each email via Infobip ---
    let sent = 0;
    let failed = 0;
    const failures: string[] = [];

    for (const recipient of recipients) {
      try {
        const form = new FormData();
        form.append('from', `${infobipSenderName} <${infobipSenderEmail}>`);
        form.append('to', `${recipient.name} <${recipient.email}>`);
        form.append('subject', subject);
        form.append('html', htmlContent);
        form.append('text', textContent);

        const response = await fetch(`${infobipBaseUrl}/email/3/send`, {
          method: 'POST',
          headers: {
            Authorization: `App ${infobipApiKey}`,
          },
          body: form,
        });

        if (response.ok) {
          sent++;
        } else {
          failed++;
          const errText = await response.text();
          failures.push(`${recipient.email}: ${errText}`);
        }
      } catch (e) {
        failed++;
        failures.push(`${recipient.email}: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, failed, failures }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
