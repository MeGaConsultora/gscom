// =====================================================================
// GScom — Función "elit" (Supabase Edge Function)
// Es la ÚNICA parte del sistema que conoce las credenciales de Elit
// (secretos ELIT_USER_ID y ELIT_TOKEN, cargados en Supabase → Edge Functions → Secrets).
// GScom la llama con la sesión del usuario; solo responde a administradores activos.
//
// Acciones (body JSON { accion }):
//   probar       → consulta 1 producto y devuelve cómo viene la respuesta (para verificar la conexión)
//   sincronizar  → baja el catálogo completo, lo guarda en elit_productos y actualiza costos
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const BASE = 'https://clientes.elit.com.ar/v1/api';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function credenciales() {
  const user_id = Number(Deno.env.get('ELIT_USER_ID'));
  const token = Deno.env.get('ELIT_TOKEN') || '';
  if (!user_id || !token) throw new Error('Faltan los secretos ELIT_USER_ID y ELIT_TOKEN en Supabase');
  return { user_id, token };
}

// Llama a la API de Elit (las credenciales van en el cuerpo, como pide su manual)
async function elit(path: string, body: Record<string, unknown> = {}, method = 'POST') {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...credenciales(), ...body }),
  });
  const texto = await r.text();
  let d: any;
  try { d = JSON.parse(texto); } catch { throw new Error(`Elit respondió algo inesperado (HTTP ${r.status})`); }
  const codigo = Number(d?.codigo ?? r.status);
  if (!r.ok || (codigo && codigo !== 200)) throw new Error(d?.mensaje || d?.message || d?.error || `Error de Elit (código ${codigo})`);
  return d;
}

// La lista de productos de la respuesta (sin depender del nombre exacto del campo)
const lista = (d: any): any[] => Array.isArray(d) ? d
  : (d?.resultado ?? d?.productos ?? d?.data ?? d?.items ?? Object.values(d ?? {}).find(Array.isArray) ?? []);
const num = (v: unknown) => (v === null || v === undefined || v === '') ? null : Number(String(v).replace(',', '.'));

// Un producto de Elit → una fila de elit_productos
function mapear(p: any, ahora: string) {
  const precio = num(p.precio), iva = num(p.iva) ?? 0, ii = num(p.impuesto_interno) ?? 0;
  const cot = num(p.cotizacion) ?? 1, markup = num(p.markup) ?? 0, pvpArs = num(p.pvp_ars);
  // Costo = lo que se le paga a Elit, en pesos y con IVA. Elit lo da como pvp_ars cuando el markup de la cuenta es 0;
  // si la cuenta tuviera markup, se lo saca. Si faltara pvp_ars, se calcula: precio × impuestos × cotización.
  const costo = pvpArs != null ? pvpArs / (1 + markup / 100)
    : precio != null ? precio * (1 + ii / 100) * (1 + iva / 100) * (Number(p.moneda) === 2 ? cot : 1) : null;
  const primera = (v: any) => Array.isArray(v) ? (v[0]?.url ?? v[0] ?? '') : (v ?? '');
  return {
    id: Number(p.id),
    codigo_alfa: p.codigo_alfa ?? null,
    codigo_producto: p.codigo_producto != null ? String(p.codigo_producto) : null,
    nombre: String(p.nombre ?? '').trim(),
    categoria: String(p.categoria ?? '').trim(),
    sub_categoria: String(p.sub_categoria ?? '').trim(),
    marca: String(p.marca ?? '').trim(),
    precio_usd: precio, iva, impuesto_interno: ii, moneda: Number(p.moneda) || null, markup, cotizacion: cot,
    costo_ars: costo == null ? null : Math.round(costo * 100) / 100,
    stock_total: num(p.stock_total) ?? 0,
    stock_cd: num(p.stock_deposito_cd) ?? 0,
    stock_cliente: num(p.stock_deposito_cliente) ?? 0,
    nivel_stock: String(p.nivel_stock ?? ''),
    ean: p.ean ? String(p.ean).trim() : null,
    garantia: p.garantia != null ? String(p.garantia) : '',
    peso: num(p.peso),
    link: String(p.link ?? ''),
    imagen: String(primera(p.imagenes ?? p.imagen)),
    miniatura: String(primera(p.miniaturas ?? p.miniatura)),
    atributos: p.atributos ?? null,
    actualizado_elit: p.actualizado != null ? String(p.actualizado) : null,
    sincronizado_at: ahora,
    activo: true,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    // Solo administradores activos de GScom (se verifica con la sesión de quien llama)
    const usuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: esAdmin, error: errAuth } = await usuario.rpc('es_usuario_activo');
    if (errAuth || !esAdmin) return json({ error: 'Sin permiso' }, 403);
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { accion } = await req.json().catch(() => ({}));

    if (accion === 'probar') {
      const d = await elit('/productos', { limit: 1 });
      const p = lista(d)[0] ?? {};
      return json({ ok: true, campos_respuesta: Object.keys(d ?? {}), campos_producto: Object.keys(p), ejemplo: p.nombre ?? null });
    }

    if (accion === 'sincronizar') {
      const ahora = new Date().toISOString();
      let offset = 0, total = 0;
      for (;;) {
        const l = lista(await elit('/productos', { limit: 100, offset }));
        if (!l.length) break;
        const filas = l.map((p) => mapear(p, ahora)).filter((x) => x.id);
        const { error } = await admin.from('elit_productos').upsert(filas);
        if (error) throw new Error(`No se pudo guardar el catálogo: ${error.message}`);
        total += l.length; offset += l.length;
        if (l.length < 100 || offset >= 30000) break;
      }
      if (!total) throw new Error('Elit no devolvió productos');
      // lo que no vino en esta sincronización completa dejó de estar en el catálogo de Elit
      await admin.from('elit_productos').update({ activo: false }).lt('sincronizado_at', ahora);
      const { data: costos, error: errCostos } = await admin.rpc('elit_aplicar_costos');
      if (errCostos) throw new Error(`No se pudieron actualizar los costos: ${errCostos.message}`);
      const resultado = { total, costos_actualizados: costos ?? 0 };
      await admin.from('elit_config').update({ ultima_sync: ahora, ultimo_resultado: resultado }).eq('id', 1);
      return json({ ok: true, ...resultado });
    }

    return json({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
