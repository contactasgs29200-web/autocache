// /api/send-photos.js
// Envoie un lot de photos en pièces jointes par email via Brevo (service
// transactionnel gratuit : 300 mails/jour). Le front découpe les photos en
// lots pour rester sous la limite de taille de requête de Vercel (~4,5 Mo).
//
// Variables d'environnement requises (à ajouter dans Vercel) :
//   BREVO_API_KEY       → clé API Brevo (Settings → SMTP & API → API Keys)
//   BREVO_SENDER_EMAIL  → adresse expéditrice VÉRIFIÉE dans Brevo
//                         (Senders, Domains & Dedicated IPs → Senders)
//   BREVO_SENDER_NAME   → (optionnel) nom affiché de l'expéditeur

export const config = { api: { bodyParser: { sizeLimit: '5mb' } } };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || 'AutoCache';
  if (!apiKey || !senderEmail) {
    return res.status(500).json({ error: 'Service email non configuré (BREVO_API_KEY / BREVO_SENDER_EMAIL manquants).' });
  }

  const { to, subject, attachments, batch } = req.body || {};
  if (!to || !EMAIL_RE.test(String(to))) {
    return res.status(400).json({ error: 'Adresse email destinataire invalide.' });
  }
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return res.status(400).json({ error: 'Aucune pièce jointe.' });
  }

  // Normalise les pièces jointes : { name, content } où content est du base64
  // pur (sans préfixe "data:...;base64,").
  const cleaned = [];
  for (const a of attachments) {
    if (!a || typeof a.content !== 'string') continue;
    const content = a.content.includes(',') ? a.content.split(',').pop() : a.content;
    const name = (a.name || 'photo.jpg').replace(/[^\w.\-]+/g, '_');
    cleaned.push({ name, content });
  }
  if (!cleaned.length) return res.status(400).json({ error: 'Pièces jointes illisibles.' });

  const label = batch && batch.total > 1 ? ` (${batch.index}/${batch.total})` : '';
  const subj = (subject || 'Vos photos AutoCache') + label;
  const count = cleaned.length;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
    <p>Bonjour,</p>
    <p>Vous trouverez en pièce jointe ${count} photo${count > 1 ? 's' : ''} traitée${count > 1 ? 's' : ''} avec AutoCache.</p>
    <p style="color:#888;font-size:12px">Email envoyé automatiquement depuis AutoCache.</p>
  </div>`;

  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: String(to) }],
        subject: subj,
        htmlContent: html,
        attachment: cleaned,
      }),
    });

    if (!r.ok) {
      let detail = '';
      try { detail = (await r.json())?.message || ''; } catch {}
      console.error('[send-photos] Brevo error', r.status, detail);
      return res.status(502).json({ error: `Échec de l'envoi (${r.status}). ${detail}`.trim() });
    }

    const data = await r.json().catch(() => ({}));
    return res.status(200).json({ ok: true, messageId: data.messageId || null, sent: count });
  } catch (e) {
    console.error('[send-photos] error', e);
    return res.status(500).json({ error: e.message || 'Erreur serveur lors de l\'envoi.' });
  }
}
