// api/_accountPhone.js — servi par api/account.js (op: "phone")
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // L'identité vient du jeton : chacun ne peut modifier que son propre compte.
  // Auparavant le `userId` du corps était utilisé tel quel, ce qui permettait
  // d'écrire le téléphone de n'importe quel compte.
  const user = await requireUser(req, res);
  if (!user) return;

  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: "Missing params" });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { error } = await supabase.auth.admin.updateUserById(user.id, { phone });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
