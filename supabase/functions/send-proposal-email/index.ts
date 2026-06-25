const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

type ProposalPayload = {
  leadId: string;
  name: string;
  email: string;
  phone: string;
  timeline: string;
  estimate: {
    total: number;
    area: number;
    downPayment: number;
    loanAmount: number;
    emi: number;
    items: Array<{ label: string; amount: number }>;
  };
  // Pre-built HTML from client (for the rich GBTI-branded email)
  htmlContent?: string;
  // Plain text fallback
  textContent?: string;
  // Base64-encoded PDF for attachment (optional)
  pdfAttachmentBase64?: string;
  pdfAttachmentName?: string;
  configuration?: {
    land: string | null;
    landSize: string | null;
    customLandArea: number;
    homeType: string;
    bedrooms: number;
    bathrooms: number;
    kitchen: string;
    addons: string[];
    roof: string;
    material: string;
    isDoubleStorey: boolean;
  };
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);

const renderItems = (items: ProposalPayload['estimate']['items']) =>
  items
    .map((item) => `<li style="margin:0 0 8px;">${item.label}: <strong>${formatMoney(item.amount)}</strong></li>`)
    .join('');

// Fallback HTML builder (used when client doesn't send htmlContent)
const buildFallbackHtml = (payload: ProposalPayload) => {
  const addons = payload.configuration?.addons?.length ? payload.configuration.addons.join(', ') : 'None';
  const landText = payload.configuration?.land === 'need'
    ? payload.configuration.landSize === 'custom'
      ? `Need land · ${payload.configuration.customLandArea} sqft`
      : `Need land · ${payload.configuration.landSize || 'Not specified'}`
    : payload.configuration?.land === 'own'
      ? 'Already own land'
      : 'Land preference not specified';

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.6;max-width:640px;margin:0 auto;padding:24px;">
      <h1 style="font-size:28px;margin:0 0 16px;">Thank you for contacting us</h1>
      <p style="margin:0 0 16px;">Hi ${payload.name},</p>
      <p style="margin:0 0 16px;">Thank you for contacting us. Our agents will contact you soon with the next steps for your proposal.</p>
      <p style="margin:0 0 24px;">Here is the current estimate based on your configuration request.</p>
      <div style="border:1px solid #e5e7eb;border-radius:16px;padding:20px;margin:0 0 24px;">
        <h2 style="font-size:20px;margin:0 0 12px;">Estimate summary</h2>
        <p style="margin:0 0 8px;">Total estimate: <strong>${formatMoney(payload.estimate.total)}</strong></p>
        <p style="margin:0 0 8px;">Area: <strong>${payload.estimate.area} sqft</strong></p>
        <p style="margin:0 0 8px;">Down payment: <strong>${formatMoney(payload.estimate.downPayment)}</strong></p>
        <p style="margin:0 0 8px;">Loan amount: <strong>${formatMoney(payload.estimate.loanAmount)}</strong></p>
        <p style="margin:0;">Estimated monthly EMI: <strong>${formatMoney(payload.estimate.emi)}</strong></p>
      </div>
      ${payload.configuration ? `
      <div style="border:1px solid #e5e7eb;border-radius:16px;padding:20px;margin:0 0 24px;">
        <h2 style="font-size:20px;margin:0 0 12px;">Configuration overview</h2>
        <p style="margin:0 0 8px;">Home type: <strong>${payload.configuration.homeType}</strong></p>
        <p style="margin:0 0 8px;">Bedrooms: <strong>${payload.configuration.bedrooms}</strong></p>
        <p style="margin:0 0 8px;">Bathrooms: <strong>${payload.configuration.bathrooms}</strong></p>
        <p style="margin:0 0 8px;">Kitchen: <strong>${payload.configuration.kitchen}</strong></p>
        <p style="margin:0 0 8px;">Roof: <strong>${payload.configuration.roof}</strong></p>
        <p style="margin:0 0 8px;">Material: <strong>${payload.configuration.material}</strong></p>
        <p style="margin:0 0 8px;">Storeys: <strong>${payload.configuration.isDoubleStorey ? 'Double' : 'Single'}</strong></p>
        <p style="margin:0 0 8px;">Land: <strong>${landText}</strong></p>
        <p style="margin:0;">Add-ons: <strong>${addons}</strong></p>
      </div>
      ` : ''}
      <div style="border:1px solid #e5e7eb;border-radius:16px;padding:20px;margin:0 0 24px;">
        <h2 style="font-size:20px;margin:0 0 12px;">Estimate breakdown</h2>
        <ul style="padding-left:20px;margin:0;">
          ${renderItems(payload.estimate.items)}
        </ul>
      </div>
      <p style="margin:0 0 8px;">Reference ID: <strong>${payload.leadId}</strong></p>
      <p style="margin:0;">Timeline preference: <strong>${payload.timeline}</strong></p>
    </div>
  `;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // All credentials read server-side — never exposed to client
    const apiKey = Deno.env.get('INFOBIP_API_KEY');
    const baseUrl = Deno.env.get('INFOBIP_BASE_URL');
    const senderEmail = Deno.env.get('INFOBIP_SENDER_EMAIL');
    const senderName = Deno.env.get('INFOBIP_SENDER_NAME') || 'GBTI Loans Team';

    if (!apiKey || !baseUrl || !senderEmail) {
      return new Response(JSON.stringify({ error: 'Missing Infobip configuration' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = await req.json() as ProposalPayload;
    if (!payload?.email || !payload?.name || !payload?.leadId) {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use rich HTML from client if provided, otherwise build a fallback
    const htmlContent = payload.htmlContent || buildFallbackHtml(payload);
    const textContent = payload.textContent || [
      `Hi ${payload.name},`,
      '',
      'Thank you for contacting us. Our agents will contact you soon.',
      '',
      `Total estimate: ${formatMoney(payload.estimate.total)}`,
      `Area: ${payload.estimate.area} sqft`,
      `Down payment: ${formatMoney(payload.estimate.downPayment)}`,
      `Loan amount: ${formatMoney(payload.estimate.loanAmount)}`,
      `Estimated monthly EMI: ${formatMoney(payload.estimate.emi)}`,
      '',
      `Reference ID: ${payload.leadId}`,
    ].join('\n');

    const form = new FormData();
    form.append('from', `${senderName} <${senderEmail}>`);
    form.append('to', `${payload.name} <${payload.email}>`);
    form.append('subject', `${payload.name} - Your GBTI Home Estimate is ready`);
    form.append('html', htmlContent);
    form.append('text', textContent);

    // Attach PDF if provided (base64 → Blob)
    if (payload.pdfAttachmentBase64 && payload.pdfAttachmentName) {
      try {
        const binaryStr = atob(payload.pdfAttachmentBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const pdfBlob = new Blob([bytes], { type: 'application/pdf' });
        form.append('attachment', pdfBlob, payload.pdfAttachmentName);
      } catch (attachErr) {
        console.warn('PDF attachment failed, sending without attachment:', attachErr);
      }
    }

    const infobipResponse = await fetch(`${baseUrl}/email/3/send`, {
      method: 'POST',
      headers: {
        Authorization: `App ${apiKey}`,
      },
      body: form,
    });

    if (!infobipResponse.ok) {
      const errorText = await infobipResponse.text();
      return new Response(JSON.stringify({ error: errorText || 'Infobip request failed' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await infobipResponse.json();
    return new Response(JSON.stringify({ ok: true, result }), {
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
