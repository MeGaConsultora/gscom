// =====================================================================
// GScom — Función "elit" (Supabase Edge Function)
// Es la ÚNICA parte del sistema que conoce las credenciales de Elit
// (secretos ELIT_USER_ID y ELIT_TOKEN, cargados en Supabase → Edge Functions → Secrets).
// GScom la llama con la sesión del usuario; solo responde a administradores activos.
//
// Acciones (body JSON { accion }):
//   probar       → consulta 1 producto y devuelve cómo viene la respuesta (para verificar la conexión)
//   sincronizar  → baja el catálogo completo, lo guarda en elit_productos y actualiza costos
//   carrito_ver / carrito_vaciar
//   carrito_agregar   { items: [{ code, quantity }], pedido_id? }
//   carrito_confirmar { pedido_id? } → COMPRA REAL (nota de venta en Elit); solo cuando un administrador
//                       lo confirma en GScom. Queda registrada en elit_compras.
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

// Catálogo completo de una sola vez, en CSV (GET /productos/csv; acá las credenciales van en la URL, como pide Elit).
// La consulta paginada de /productos devuelve de a 40 y no respeta "offset", por eso se usa esta.
function parseCsv(t: string): string[][] {
  const filas: string[][] = []; let f: string[] = [], c = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { f.push(c); c = ''; }
    else if (ch === '\n') { f.push(c); filas.push(f); f = []; c = ''; }
    else if (ch !== '\r') c += ch;
  }
  if (c || f.length) { f.push(c); filas.push(f); }
  return filas;
}
async function catalogoCsv(): Promise<any[]> {
  const { user_id, token } = credenciales();
  const r = await fetch(`${BASE}/productos/csv?user_id=${encodeURIComponent(user_id)}&token=${encodeURIComponent(token)}`);
  let t = await r.text();
  if (!r.ok || t.trimStart().startsWith('{')) {
    let msg = `HTTP ${r.status}`; try { const d = JSON.parse(t); msg = d.mensaje || d.message || d.error || msg; } catch { /* no era JSON */ }
    throw new Error(`Elit no entregó el catálogo CSV (${msg})`);
  }
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  if (/^sep=/i.test(t)) t = t.slice(t.indexOf('\n') + 1);       // primera línea "sep=," (para Excel)
  const filas = parseCsv(t);
  const h = (filas.shift() ?? []).map((s) => s.trim());
  if (!h.includes('id') || !h.includes('nombre')) throw new Error('El CSV de Elit no tiene el formato esperado');
  return filas.filter((f) => f.length >= h.length - 2 && f[0]).map((f) => Object.fromEntries(h.map((k, i) => [k, f[i] ?? ''])));
}

// La lista de productos de la respuesta (sin depender del nombre exacto del campo)
const lista = (d: any): any[] => Array.isArray(d) ? d
  : (d?.resultado ?? d?.productos ?? d?.data ?? d?.items ?? Object.values(d ?? {}).find(Array.isArray) ?? []);
// Total de productos del catálogo, si Elit lo informa (en algún campo tipo paginador.total)
const totalDe = (d: any): number | null => {
  const t = d?.paginador?.total ?? d?.paginacion?.total ?? d?.total ?? d?.cantidad ?? d?.meta?.total ?? null;
  return t == null || isNaN(Number(t)) ? null : Number(t);
};
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
    // en el CSV llegan como texto (vacío, o JSON): se guardan como dato estructurado si se puede
    atributos: typeof p.atributos === 'string' ? (p.atributos.trim() ? (() => { try { return JSON.parse(p.atributos); } catch { return p.atributos; } })() : null) : (p.atributos ?? null),
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

    const cuerpo: any = await req.json().catch(() => ({}));
    const { accion } = cuerpo;

    if (accion === 'probar') {
      // dos páginas seguidas: cuántos trae cada una y si la segunda es distinta (para verificar la paginación)
      const d1 = await elit('/productos', { limit: 100, offset: 0 });
      const l1 = lista(d1);
      const l2 = l1.length ? lista(await elit('/productos', { limit: 100, offset: l1.length })) : [];
      const p = l1[0] ?? {};
      return json({ ok: true, campos_respuesta: Object.keys(d1 ?? {}), campos_producto: Object.keys(p), ejemplo: p.nombre ?? null,
        por_pagina: l1.length, segunda_pagina: l2.length, segunda_distinta: !!l2.length && Number(l2[0]?.id) !== Number(l1[0]?.id),
        total_informado: totalDe(d1), paginador: d1?.paginador ?? null });
    }

    if (accion === 'sincronizar') {
      const ahora = new Date().toISOString();
      // 1) catálogo completo en CSV; 2) si eso falla, consulta paginada (puede venir incompleta)
      let productos: any[] = [], origen = 'csv', aviso = '';
      try { productos = await catalogoCsv(); } catch (e) { aviso = (e as Error).message; }
      if (!productos.length) {
        origen = 'paginas';
        const vistos = new Set<number>();
        let offset = 0;
        for (let pagina = 0; pagina < 500; pagina++) {
          const l = lista(await elit('/productos', { limit: 100, offset }));
          const nuevos = l.filter((p) => !vistos.has(Number(p.id)));
          if (!nuevos.length) break;           // página vacía o repetida: no hay más
          nuevos.forEach((p) => vistos.add(Number(p.id)));
          productos.push(...nuevos); offset += l.length;
        }
      }
      const filasTodas = productos.map((p) => mapear(p, ahora)).filter((x) => x.id);
      const unicas = [...new Map(filasTodas.map((x) => [x.id, x])).values()];
      for (let i = 0; i < unicas.length; i += 500) {
        const { error } = await admin.from('elit_productos').upsert(unicas.slice(i, i + 500));
        if (error) throw new Error(`No se pudo guardar el catálogo: ${error.message}`);
      }
      const total = unicas.length;
      if (!total) throw new Error(`Elit no devolvió productos${aviso ? ` (${aviso})` : ''}`);
      // lo que no vino en esta sincronización completa dejó de estar en el catálogo de Elit
      await admin.from('elit_productos').update({ activo: false }).lt('sincronizado_at', ahora);
      const { data: costos, error: errCostos } = await admin.rpc('elit_aplicar_costos');
      if (errCostos) throw new Error(`No se pudieron actualizar los costos: ${errCostos.message}`);
      const resultado = { total, costos_actualizados: costos ?? 0, origen, ...(aviso ? { aviso } : {}) };
      await admin.from('elit_config').update({ ultima_sync: ahora, ultimo_resultado: resultado }).eq('id', 1);
      return json({ ok: true, ...resultado });
    }

    // ---------- Carrito de Elit (etapa 2) ----------
    if (accion === 'carrito_ver') return json(await elit('/carrito/ver'));

    if (accion === 'carrito_vaciar') return json(await elit('/carrito', {}, 'DELETE'));

    if (accion === 'carrito_agregar') {
      // items: [{ code: id del producto en Elit, quantity }]. Ojo: en Elit "quantity" REEMPLAZA la cantidad, no suma.
      const items = Array.isArray(cuerpo.items) ? cuerpo.items : [];
      if (!items.length) throw new Error('No hay productos para enviar');
      const errores: { code: number; error: string }[] = [];
      let agregados = 0;
      for (const it of items) {
        const code = Number(it.code), quantity = Number(it.quantity);
        if (!code || !(quantity > 0)) { errores.push({ code, error: 'Código o cantidad inválidos' }); continue; }
        try { await elit('/carrito', { code, quantity }); agregados++; }
        catch (e) { errores.push({ code, error: (e as Error).message }); }
      }
      if (cuerpo.pedido_id && agregados) await admin.from('pedidos').update({ elit_enviado_at: new Date().toISOString() }).eq('id', Number(cuerpo.pedido_id));
      return json({ ok: true, agregados, errores });
    }

    if (accion === 'carrito_confirmar') {
      // COMPRA REAL: genera la nota de venta en Elit. Solo se llama cuando un administrador lo confirma en GScom.
      const d = await elit('/carrito/confirmar');
      const { data: u } = await usuario.auth.getUser();
      const pedido_id = cuerpo.pedido_id ? Number(cuerpo.pedido_id) : null;
      await admin.from('elit_compras').insert({ usuario_id: u?.user?.id ?? null, pedido_id, respuesta: d });
      if (pedido_id) await admin.from('pedidos').update({ elit_confirmado_at: new Date().toISOString(), elit_notas: d?.notas ?? d }).eq('id', pedido_id);
      return json(d);
    }

    return json({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
