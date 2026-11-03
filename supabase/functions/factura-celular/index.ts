// =====================================================================
// GScom — Función "factura-celular" (Supabase Edge Function), SIN sesión
// La usa el celular que escaneó el QR de la PC para mandar las fotos de una factura.
// El QR lleva un token de un solo uso (tabla factura_celular): solo sirve si existe,
// está "esperando" y tiene menos de 15 minutos. Con ese token lo ÚNICO que se puede
// hacer es subir los archivos de esa factura: no da acceso a nada más de GScom.
// Body JSON:
//   { accion: 'estado', token }                         → { ok: true } si el código sirve
//   { accion: 'subir', token, archivos: [{ tipo, datos }] } → guarda los archivos (base64) y marca el pedido "subido"
// En Supabase: publicarla con "Verify JWT" DESACTIVADO (el celular no tiene sesión; el control lo hace el token).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const VENCE_MS = 15 * 60000;
const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const cuerpo: any = await req.json().catch(() => ({}));
    const token = String(cuerpo.token || '');
    if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: 'El código no es válido.' }, 400);

    const { data: p } = await admin.from('factura_celular').select('*').eq('token', token).maybeSingle();
    const sirve = p && p.estado === 'esperando' && Date.now() - new Date(p.creado).getTime() < VENCE_MS;
    if (!sirve) return json({ error: p?.estado === 'subido' ? 'Esta factura ya se mandó: seguí en la PC.' : 'El código venció o ya se usó. Pedí uno nuevo desde la PC.' }, 410);
    if (cuerpo.accion === 'estado') return json({ ok: true });
    if (cuerpo.accion !== 'subir') return json({ error: 'Acción desconocida' }, 400);

    const archivos: any[] = Array.isArray(cuerpo.archivos) ? cuerpo.archivos : [];
    if (!archivos.length || archivos.length > 10) return json({ error: 'Mandá entre 1 y 10 archivos.' }, 400);
    if (archivos.some(a => !EXT[a?.tipo]) || (archivos.length > 1 && archivos.some(a => a.tipo === 'application/pdf')))
      return json({ error: 'Mandá fotos (JPG, PNG) o un solo PDF.' }, 400);
    const binarios = archivos.map(a => Uint8Array.from(atob(String(a.datos || '')), c => c.charCodeAt(0)));
    const peso = binarios.reduce((s, b) => s + b.length, 0);
    if (!peso || peso > 20 * 1024 * 1024) return json({ error: 'Los archivos pesan demasiado (máximo 20 MB en total).' }, 400);

    const mes = new Date().toISOString().slice(0, 7), rutas: string[] = [];
    for (let i = 0; i < archivos.length; i++) {
      const ruta = `compras/${mes}/${crypto.randomUUID()}.${EXT[archivos[i].tipo]}`;
      const { error } = await admin.storage.from('facturas').upload(ruta, binarios[i], { contentType: archivos[i].tipo });
      if (error) { if (rutas.length) await admin.storage.from('facturas').remove(rutas); return json({ error: 'No se pudo guardar el archivo. Probá de nuevo.' }, 500); }
      rutas.push(ruta);
    }
    // se marca "subido" solo si sigue esperando (un solo uso, aunque lleguen dos envíos a la vez)
    const { data: marcado } = await admin.from('factura_celular').update({ estado: 'subido', archivos: rutas })
      .eq('token', token).eq('estado', 'esperando').select('token');
    if (!marcado?.length) { await admin.storage.from('facturas').remove(rutas); return json({ error: 'Esta factura ya se mandó.' }, 410); }
    return json({ ok: true, archivos: rutas.length });
  } catch (e) {
    console.error(e);
    return json({ error: 'No se pudo mandar la factura. Probá de nuevo.' }, 500);
  }
});
