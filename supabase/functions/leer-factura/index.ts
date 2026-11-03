// =====================================================================
// GScom — Función "leer-factura" (Supabase Edge Function)
// Lee una factura o remito de proveedor (PDF o fotos) con Claude y devuelve sus datos
// para completar "Ingresar mercadería". Es la ÚNICA parte del sistema que conoce la
// clave de IA (secreto ANTHROPIC_API_KEY, cargado en Supabase → Edge Functions → Secrets).
// Solo responde a administradores activos de GScom (con su sesión).
//
// Body JSON: { archivos: ["compras/2026-11/xxxx.pdf", ...] }  → rutas en el bucket privado "facturas"
//            (un PDF, o hasta 10 fotos: una por hoja). El navegador los sube antes de llamar.
// Respuesta: { factura, uso: { modelo, tokens_entrada, tokens_salida, costo_usd } }
// Cada lectura queda anotada en la tabla uso_ia.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
class ErrorUsuario extends Error {}
const falla = (m: string): never => { throw new ErrorUsuario(m); };

// Mismo modelo, formato e instrucciones que Kiosco (probados con facturas argentinas)
const MODELO = 'claude-opus-5-5';
// USD por millón de tokens (entrada, salida), para estimar el costo. El detalle real está en la consola de Anthropic.
const PRECIOS: Record<string, [number, number]> = { 'claude-opus-5-5': [4, 20], 'claude-opus-5': [5, 25], 'claude-opus-4-8': [5, 25], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] };
const TIPOS: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const nuloDe = (tipo: string) => ({ anyOf: [{ type: tipo }, { type: 'null' }] });
// Ojo: la salida estructurada acepta como máximo 16 campos que pueden ser null, y ya se usan los 16.
const ESQUEMA = {
  type: 'object', additionalProperties: false,
  required: ['proveedor', 'comprobante', 'fecha', 'items', 'descuento_global', 'otros_cargos', 'subtotal', 'iva', 'percepciones', 'total', 'observaciones'],
  properties: {
    proveedor: { type: 'object', additionalProperties: false, required: ['nombre', 'cuit'], properties: { nombre: { type: 'string' }, cuit: nuloDe('string') } },
    comprobante: nuloDe('string'),
    fecha: nuloDe('string'),
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['codigo', 'codigo_barras', 'descripcion', 'cantidad', 'unidad', 'unidades_por_bulto', 'precio_unitario', 'bonificacion', 'importe', 'alicuota_iva', 'precio_sugerido'],
        properties: {
          codigo: nuloDe('string'), codigo_barras: { type: 'string' }, descripcion: { type: 'string' }, cantidad: { type: 'number' },
          unidad: { type: 'string', enum: ['unidad', 'bulto', 'kg'] }, unidades_por_bulto: nuloDe('number'),
          precio_unitario: nuloDe('number'), bonificacion: nuloDe('number'), importe: { type: 'number' },
          alicuota_iva: nuloDe('number'), precio_sugerido: nuloDe('number'),
        },
      },
    },
    descuento_global: nuloDe('number'), otros_cargos: nuloDe('number'),
    subtotal: nuloDe('number'), iva: nuloDe('number'), percepciones: nuloDe('number'), total: nuloDe('number'),
    observaciones: nuloDe('string'),
  },
};
const INSTRUCCIONES = `Leés facturas y remitos de proveedores para un comercio de informática de Argentina (computadoras, componentes, periféricos, insumos), y devolvés sus datos para cargar la compra. El archivo puede ser un PDF, un escaneo o fotos de celular (una por hoja, en orden).

- proveedor: quien EMITE el comprobante (arriba, con su CUIT). Nunca el cliente o comprador.
- comprobante: tipo y número tal como figuran, por ejemplo "A 0003-00068600". fecha: en formato AAAA-MM-DD.
- codigo: el código del producto del proveedor (su código interno, como figura). codigo_barras: el código de barras del producto (EAN o UPC, de 8 a 14 números), solo si el renglón lo trae aparte o el código del proveedor es ese mismo número; si no, cadena vacía ("").
- items: un renglón por producto, en el orden de la factura. Lo que no es mercadería (flete, envío, "recupero de gastos") no va como renglón: se suma en otros_cargos. Un descuento sobre toda la factura tampoco: va en descuento_global, como número positivo.
- cantidad y unidad:
  - Si el precio del renglón es por bulto o caja, unidad "bulto", cantidad = cantidad de bultos, y unidades_por_bulto = cuántas unidades trae el bulto si figura.
  - Si el precio es por unidad, unidad "unidad" y cantidad = total de unidades.
  - Si se cobra por peso o por metro, unidad "kg" y cantidad = los kilos o metros.
- importe: el importe del renglón tal como figura, ya con su bonificación y sin IVA. precio_unitario y bonificacion (en %) como figuran.
- alicuota_iva: la del renglón si figura; si no, la de la factura (21 o 10,5).
- precio_sugerido: precio de venta sugerido al público por unidad, solo si la factura lo trae.
- subtotal: neto gravado de toda la factura (sin IVA). iva: total de IVA. percepciones: suma de todas las percepciones (IVA, IIBB, municipal). total: total final.
- Si la factura es tipo B o C (el IVA no se discrimina), importe y precio_unitario van con IVA incluido tal como figuran, alicuota_iva = 0 e iva = 0.
- Números: devolvelos como números con punto decimal. Las facturas pueden usar "1.234,56" o "1,234.56": interpretalos según el contexto y verificá que cantidad × precio_unitario × (1 − bonificación) dé el importe, y que la suma de renglones cierre con el subtotal.
- Ignorá tildes, sellos, marcas de agua y anotaciones a mano que no sean parte del comprobante.
- Si algo no se lee o no figura, poné null: nunca inventes datos. En observaciones anotá en una o dos frases lo dudoso (renglones ilegibles, cuentas que no cierran); si no hay nada, null.`;

// base64 sin pasar por un string gigante de una sola vez (los PDF pueden pesar varios MB)
function aBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function leer(bloques: any[]) {
  const clave = Deno.env.get('ANTHROPIC_API_KEY');
  if (!clave) falla('Falta cargar la clave de IA (secreto ANTHROPIC_API_KEY) en Supabase → Edge Functions → Secrets.');
  const cliente = new Anthropic({ apiKey: clave });
  let r: any;
  try {
    r = await cliente.beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      // si un filtro de seguridad rechazara la lectura, Anthropic la reintenta con el modelo recomendado
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA } },
      system: INSTRUCCIONES,
      messages: [{ role: 'user', content: [...bloques, { type: 'text', text: bloques.length > 1 ? `Son ${bloques.length} hojas del mismo comprobante, en orden. Leelo y devolvé sus datos.` : 'Leé este comprobante y devolvé sus datos.' }] }],
    } as any);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) falla('La clave de IA no es válida o fue desactivada.');
    if (e instanceof Anthropic.PermissionDeniedError) falla('La clave de IA no tiene permiso para usar este modelo.');
    if (e instanceof Anthropic.RateLimitError) falla('Se hicieron muchas lecturas seguidas: probá de nuevo en un minuto.');
    if (e instanceof Anthropic.BadRequestError) falla(`La IA no pudo procesar el archivo: ${(e as Error).message}`);
    if (e instanceof Anthropic.APIConnectionError) falla('No se pudo conectar con la IA. Probá de nuevo en un rato.');
    if (e instanceof Anthropic.APIError) falla(`La IA respondió con un error (${(e as any).status}). Probá de nuevo en un rato.`);
    throw e;
  }
  if (r.stop_reason === 'refusal') falla('La IA no quiso leer este archivo. Revisá que sea una factura o remito.');
  if (r.stop_reason === 'max_tokens') falla('La factura es demasiado larga para leerla de una vez.');
  const texto = r.content.find((b: any) => b.type === 'text')?.text;
  let factura: any;
  try { factura = JSON.parse(texto); } catch { falla('La IA devolvió algo que no se pudo entender. Probá de nuevo.'); }
  const u = r.usage || {};
  const entrada = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  const [pe, ps] = PRECIOS[r.model] || PRECIOS[MODELO];
  return { factura, uso: { modelo: r.model, tokens_entrada: entrada, tokens_salida: u.output_tokens || 0, costo_usd: Math.round((entrada * pe + (u.output_tokens || 0) * ps) / 1e6 * 10000) / 10000 } };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const usuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: esAdmin, error: errAuth } = await usuario.rpc('es_usuario_activo');
    if (errAuth || !esAdmin) return json({ error: 'Sin permiso' }, 403);
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const cuerpo: any = await req.json().catch(() => ({}));
    const rutas: string[] = Array.isArray(cuerpo.archivos) ? cuerpo.archivos.map(String) : [];
    if (!rutas.length) falla('No llegó ningún archivo.');
    if (rutas.length > 10) falla('Como máximo 10 hojas por factura.');
    const bloques: any[] = [];
    let peso = 0;
    for (const ruta of rutas) {
      if (!/^compras\/[\w\-/]+\.(pdf|jpe?g|png|webp)$/i.test(ruta)) falla('Archivo no válido.');
      const ext = ruta.split('.').pop()!.toLowerCase();
      const { data, error } = await admin.storage.from('facturas').download(ruta);
      if (error || !data) falla('No se encontró el archivo subido. Probá de nuevo.');
      const bytes = new Uint8Array(await data!.arrayBuffer());
      peso += bytes.length;
      if (peso > 25 * 1024 * 1024) falla('Los archivos pesan demasiado (máximo 25 MB en total).');
      const tipo = TIPOS[ext];
      bloques.push(tipo === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: tipo, data: aBase64(bytes) } }
        : { type: 'image', source: { type: 'base64', media_type: tipo, data: aBase64(bytes) } });
    }

    const { factura, uso } = await leer(bloques);
    const { data: u } = await usuario.auth.getUser();
    await admin.from('uso_ia').insert({ usuario_id: u?.user?.id ?? null, tarea: 'leer_factura', archivos: rutas,
      resultado: `${(factura.items || []).length} renglones`, ...uso });
    return json({ factura, uso });
  } catch (e) {
    if (e instanceof ErrorUsuario) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: 'No se pudo leer la factura. Probá de nuevo.' }, 500);
  }
});
