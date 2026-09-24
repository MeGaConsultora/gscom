// Conexión a Supabase. Si SUPABASE_URL queda vacío, la app funciona en MODO DEMO
// (datos de ejemplo en el navegador). La publishable key es pública por diseño:
// la seguridad está en las políticas RLS de la base (sql/01_esquema.sql).
export const SUPABASE_URL = '';
export const SUPABASE_KEY = '';
