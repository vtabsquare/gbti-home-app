import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token',
};

// Actions that do NOT require a valid session (pre-auth flows)
const PUBLIC_ACTIONS = new Set([
  'send_admin_login_otp',
  'verify_admin_login_otp',
  'set_admin_reset_code',
  'verify_admin_reset_code',
]);

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

    // supabaseAdmin - service role with explicit public schema for direct table access
    // Service role bypasses RLS and PostgREST exposed-schema restriction
    const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
      db: { schema: 'public' },
    });

    // supabaseApi targets the 'api' schema for all stored procedure (RPC) calls
    // The 'api' schema is the only one exposed via PostgREST for the anon key,
    // but service role can access it too.
    const supabaseApi = createClient(supabaseUrl, supabaseKey, {
      db: { schema: 'api' },
    });

    // Parse request body early so we know the action
    const body = await req.json();
    const { action, payload } = body;

    // ── Auth gate ─────────────────────────────────────────────────────────
    if (!PUBLIC_ACTIONS.has(action)) {
      const sessionToken = req.headers.get('x-session-token');

      if (!sessionToken) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Missing session token' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // verify_admin_session exists in both api and public schemas
      const { data: isValid, error: verifyError } = await supabaseApi.rpc('verify_admin_session', {
        p_token: sessionToken,
      });

      if (verifyError || !isValid) {
        return new Response(JSON.stringify({
          error: 'Unauthorized: Invalid or expired session',
          debug: {
            tokenReceived: sessionToken ? `${sessionToken.substring(0, 8)}...` : 'null',
            verifyError: verifyError ? verifyError.message : null,
            isValid,
          }
        }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    let result: any;

    switch (action) {

      // ── Pre-auth (no session required, use api schema wrappers) ──────────
      case 'send_admin_login_otp':
        result = await supabaseApi.rpc('send_admin_login_otp', { p_email: payload.email });
        break;

      case 'verify_admin_login_otp':
        result = await supabaseApi.rpc('verify_admin_login_otp', {
          p_otp: payload.otp,
          p_email: payload.email,
        });
        break;

      case 'set_admin_reset_code':
        result = await supabaseApi.rpc('set_admin_reset_code', { p_email: payload.email });
        break;

      case 'verify_admin_reset_code':
        result = await supabaseApi.rpc('verify_admin_reset_code', {
          p_email: payload.email,
          p_code: payload.code,
          p_new_password: payload.new_password,
        });
        break;

      // ── User management (session required, use api schema wrappers) ──────
      case 'list_admin_users':
        result = await supabaseApi.rpc('list_admin_users');
        break;

      case 'create_admin_user':
        result = await supabaseApi.rpc('create_admin_user', {
          p_email: payload.email,
          p_display_name: payload.display_name,
        });
        break;

      case 'delete_admin_user':
        result = await supabaseApi.rpc('delete_admin_user', { p_user_id: payload.user_id });
        break;

      case 'change_admin_password':
        result = await supabaseApi.rpc('change_admin_password', {
          p_user_id: payload.user_id,
          p_new_password: payload.new_password,
        });
        break;

      // ── Leads (direct table access via service role) ──────────────────────
      case 'get_leads':
        result = await supabaseApi.rpc('admin_table_op', { p_op: 'SELECT', p_table: 'leads' });
        break;
      case 'delete_lead':
        result = await supabaseApi.rpc('admin_table_op', { p_op: 'DELETE', p_table: 'leads', p_match_col: 'id', p_match_val: payload.id });
        break;

      // ── Presets ──────────────────────────────────────────────────────────
      case 'get_presets':
        result = await supabaseApi.rpc('admin_table_op', { p_op: 'SELECT', p_table: 'presets' });
        break;
      case 'upsert_preset':
        result = await supabaseApi.rpc('admin_table_op', { p_op: 'UPSERT', p_table: 'presets', p_payload: payload });
        break;
      case 'delete_preset':
        result = await supabaseApi.rpc('admin_table_op', { p_op: 'DELETE', p_table: 'presets', p_match_col: 'id', p_match_val: payload.id });
        break;

      // ── Elevation Images ─────────────────────────────────────────────────
      case 'get_elevation_images':
        result = await supabaseApi.rpc('admin_table_op', { p_op: 'SELECT', p_table: 'elevation_images' });
        break;
      case 'insert_elevation_image':
        result = await supabaseApi.rpc('admin_table_op', { p_op: 'INSERT', p_table: 'elevation_images', p_payload: payload });
        break;
      case 'delete_elevation_image':
        result = await supabaseApi.rpc('admin_table_op', { p_op: 'DELETE', p_table: 'elevation_images', p_match_col: 'id', p_match_val: payload.id });
        break;

      // ── Admin Settings ───────────────────────────────────────────────────
      case 'get_admin_settings':
        result = await supabaseApi.rpc('admin_query', { p_query: 'SELECT * FROM public.admin_settings ORDER BY key ASC' });
        break;
      case 'upsert_admin_settings':
        result = await supabaseApi.rpc('admin_table_op', { p_op: 'UPSERT', p_table: 'admin_settings', p_payload: payload });
        break;

      // ── Mortgage Settings ────────────────────────────────────────────────
      case 'get_mortgage_settings':
        result = await supabaseApi.rpc('admin_table_op', { p_op: 'SELECT_SINGLE', p_table: 'mortgage_settings' });
        break;
      case 'upsert_mortgage_settings':
        if (payload.id) {
          result = await supabaseApi.rpc('admin_table_op', { p_op: 'UPDATE', p_table: 'mortgage_settings', p_payload: payload, p_match_col: 'id', p_match_val: payload.id });
        } else {
          result = await supabaseApi.rpc('admin_table_op', { p_op: 'INSERT', p_table: 'mortgage_settings', p_payload: payload });
        }
        break;

      // ── Fee Rules ────────────────────────────────────────────────────────
      case 'get_fee_rules':
        result = await supabaseApi.rpc('admin_table_op', { p_op: 'SELECT_SINGLE', p_table: 'fee_rules' });
        break;
      case 'update_fee_rules': {
        const { data: feeRowRes } = await supabaseApi.rpc('admin_table_op', { p_op: 'SELECT_SINGLE', p_table: 'fee_rules' });
        const feeRow = feeRowRes;
        result = await supabaseApi.rpc('admin_table_op', { p_op: 'UPDATE', p_table: 'fee_rules', p_payload: {
          solicitor_fee_percent: payload.p_solicitor,
          solicitor_fixed_charge: payload.p_solicitor_fixed,
          registry_fee_percent: payload.p_registry,
          stamp_duty_percent: payload.p_stamp,
          misc_fee: payload.p_misc,
          vat_enabled: payload.p_vat_enabled,
          vat_percent: payload.p_vat_percent,
        }, p_match_col: 'id', p_match_val: feeRow?.id });
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    if (result?.error) {
      throw result.error;
    }

    return new Response(JSON.stringify({ data: result?.data ?? null }), {
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
