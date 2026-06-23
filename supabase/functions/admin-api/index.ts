import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Server configuration missing');
    }

    // Create a client with the SERVICE ROLE key to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

    // Get the session token from headers
    const sessionToken = req.headers.get('x-session-token');
    
    if (!sessionToken) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Missing session token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify session token
    const { data: isValid, error: verifyError } = await supabaseAdmin.rpc('verify_admin_session', {
      p_token: sessionToken,
    });

    if (verifyError || !isValid) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Session is valid. Parse request body
    const body = await req.json();
    const { action, payload } = body;

    let result;

    switch (action) {
      // Leads
      case 'get_leads':
        result = await supabaseAdmin.from('leads').select('*').order('created_at', { ascending: false });
        break;
      case 'delete_lead':
        result = await supabaseAdmin.from('leads').delete().eq('id', payload.id);
        break;

      // Presets
      case 'get_presets':
        result = await supabaseAdmin.from('presets').select('*').order('created_at', { ascending: false });
        break;
      case 'upsert_preset':
        result = await supabaseAdmin.from('presets').upsert(payload);
        break;
      case 'delete_preset':
        result = await supabaseAdmin.from('presets').delete().eq('id', payload.id);
        break;

      // Elevation Images
      case 'get_elevation_images':
        result = await supabaseAdmin.from('elevation_images').select('*').order('created_at', { ascending: false });
        break;
      case 'insert_elevation_image':
        result = await supabaseAdmin.from('elevation_images').insert(payload);
        break;
      case 'delete_elevation_image':
        result = await supabaseAdmin.from('elevation_images').delete().eq('id', payload.id);
        break;

      // Admin Settings
      case 'get_admin_settings':
        result = await supabaseAdmin.from('admin_settings').select('*');
        break;
      case 'upsert_admin_settings':
        result = await supabaseAdmin.from('admin_settings').upsert(payload);
        break;

      // Mortgage Settings
      case 'get_mortgage_settings':
        result = await supabaseAdmin.from('mortgage_settings').select('*').limit(1).maybeSingle();
        break;
      case 'upsert_mortgage_settings':
        if (payload.id) {
          result = await supabaseAdmin.from('mortgage_settings').update(payload).eq('id', payload.id);
        } else {
          result = await supabaseAdmin.from('mortgage_settings').insert(payload);
        }
        break;

      // Fee Rules
      case 'get_fee_rules':
        result = await supabaseAdmin.from('fee_rules').select('*').limit(1).maybeSingle();
        break;
      case 'update_fee_rules':
        result = await supabaseAdmin.rpc('update_fee_rules', payload);
        break;

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    if (result.error) {
      throw result.error;
    }

    return new Response(JSON.stringify({ data: result.data || null }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
