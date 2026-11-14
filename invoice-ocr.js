// Vercel serverless function: reads an invoice photo with Claude vision and returns structured JSON.
// Needs the ANTHROPIC_API_KEY environment variable in Vercel (Project Settings -> Environment Variables).
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

const SYSTEM = 'You read photos of Indian tax invoices / delivery challans for a warehouse. ' +
  'Return ONLY one JSON object, no markdown, no commentary. Never guess: use null when a value is not clearly printed.';

const PROMPT = 'Extract this invoice as JSON with exactly this shape:\n' +
  '{"vehicleNo": string|null, "lrNo": string|null, "invoiceNo": string|null, "customer": string|null, ' +
  '"materials": [{"material": string, "description": string, "ean": string|null, "qty": integer}]}\n' +
  'Rules:\n' +
  '- vehicleNo: truck/vehicle number printed on the invoice (labels like Vehicle No, Truck No, Lorry No, Veh No). Keep letters and digits exactly as printed.\n' +
  '- lrNo: LR / GR / Lorry Receipt / Consignment note number (labels like LR No, L.R. No, GR No). Exactly as printed.\n' +
  '- invoiceNo: the invoice number.\n' +
  '- customer: the party the goods are billed/shipped to.\n' +
  '- materials: one entry per item line. material = item/material/article code (if only a name is printed, use the name). ' +
  'description = item description. ean = barcode/EAN/HSN-independent barcode number, digits only (NOT the HSN code), null if absent. ' +
  'qty = invoiced quantity as an integer.\n' +
  'Return only the JSON object.';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const image = body && body.image;
  const mediaType = (body && body.mediaType) || 'image/jpeg';
  if (!image || typeof image !== 'string') { res.status(400).json({ error: 'image (base64) is required' }); return; }
  if (['image/jpeg', 'image/png', 'image/webp'].indexOf(mediaType) < 0) { res.status(400).json({ error: 'Unsupported image type' }); return; }
  if (image.length > 5500000) { res.status(413).json({ error: 'Image is too large' }); return; }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: PROMPT }
        ] }]
      })
    });
    const data = await r.json();
    if (!r.ok) { res.status(502).json({ error: (data && data.error && data.error.message) || ('AI service error ' + r.status) }); return; }
    const text = (data.content || []).map(function (c) { return c.type === 'text' ? c.text : ''; }).join('').trim();
    const clean = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); } catch (e) { res.status(422).json({ error: 'Could not read the invoice. Please retake a clearer photo.' }); return; }
    parsed.materials = Array.isArray(parsed.materials) ? parsed.materials : [];
    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: 'Invoice read failed: ' + e.message });
  }
};
