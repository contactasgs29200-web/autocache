import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { userId, phone } = req.body;
  if (!userId || !phone) return res.status(400).json({ error: "Missing params" });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { error } = await supabase.auth.admin.updateUserById(userId, { phone });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
