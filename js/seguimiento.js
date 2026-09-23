import { store, estadoInfo } from './store.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fdate = iso => iso ? new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' }) : '';
const fdatetime = iso => new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const money = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
const FLUJO = ['recibido', 'diagnostico', 'presupuesto', 'reparacion', 'listo', 'entregado'];
const app = document.getElementById('app');

const token = new URLSearchParams(location.search).get('t');
const o = token ? await store.seguimiento(token) : null;

if (!o) {
  app.innerHTML = `<div class="card card-pad empty"><b>No encontramos esa orden.</b><br>Revisá que el link esté completo o comunicate con nosotros.</div>`;
} else {
  const e = estadoInfo(o.estado);
  const pos = o.estado === 'repuesto' ? 3 : o.estado === 'sin_reparacion' ? 4 : FLUJO.indexOf(o.estado);
  const ultimo = [...o.historial].reverse().find(h => h.estado === o.estado && h.comentario);
  const n = o.negocio;
  const wa = n.whatsapp ? `https://wa.me/${n.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola! Consulto por mi orden #${o.numero}.`)}` : '';
  document.title = `Orden #${o.numero} — ${e.label}`;

  app.innerHTML = `
  <div class="card status">
    <div class="num">Hola ${esc(o.cliente)} · Orden #${o.numero}</div>
    <div class="eq">${esc(o.equipo)}</div>
    <div class="stepper">${FLUJO.map((s, i) => {
      let label = estadoInfo(s).label;
      if (i === pos && o.estado === 'repuesto') label = 'Esperando repuesto';
      if (i === pos && o.estado === 'sin_reparacion') label = 'Sin reparación';
      return `<div class="step ${i < pos ? 'done' : ''} ${i === pos ? 'current' : ''}">${esc(label)}</div>`;
    }).join('')}</div>
    <div class="big big-${e.color}">${esc(e.label)}</div>
    <div class="msg">${esc(ultimo?.comentario || e.cliente)}</div>
    ${o.presupuesto && ['presupuesto', 'reparacion', 'repuesto', 'listo'].includes(o.estado) ? `<div style="margin-top:1rem" class="small muted">Presupuesto</div><div style="font-size:1.3rem;font-weight:600">${money(o.presupuesto)}</div>` : ''}
    ${o.fecha_estimada && !['listo', 'entregado', 'sin_reparacion'].includes(o.estado) ? `<div class="small muted" style="margin-top:.8rem">Fecha estimada: <b>${fdate(o.fecha_estimada)}</b></div>` : ''}
  </div>
  <div class="card card-pad"><h2>Novedades</h2><div class="timeline">
    ${[...o.historial].reverse().map(h => `<div class="tl-item"><div class="when">${fdatetime(h.fecha)}</div><div class="what">${esc(estadoInfo(h.estado).label)}</div>${h.comentario ? `<div class="detail">${esc(h.comentario)}</div>` : ''}</div>`).join('')}
  </div>
  <div class="small muted" style="margin-top:.3rem">Falla informada: ${esc(o.falla)}</div></div>
  <div class="card card-pad"><h2>${esc(n.nombre)}</h2>
    <div class="small" style="line-height:1.7">${esc(n.direccion)}<br>${esc(n.telefono)}${n.horario ? `<br><span class="muted">${esc(n.horario)}</span>` : ''}</div>
    ${wa ? `<a class="btn wa block" style="margin-top:1rem" href="${wa}" target="_blank" rel="noopener">Consultar por WhatsApp</a>` : ''}
  </div>`;
}
