import { store, estadoInfo, linkWhatsApp } from './store.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fdate = iso => iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T00:00' : iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' }) : '';
const fdatetime = iso => new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const money = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
const FLUJO = ['recibido', 'diagnostico', 'presupuesto', 'reparacion', 'listo', 'entregado'];
const esRespuestaCliente = txt => /^El cliente (ACEPTÓ|RECHAZÓ)/.test(txt || '');
const app = document.getElementById('app');
const token = new URLSearchParams(location.search).get('t');

function render(o) {
  if (!o) {
    app.innerHTML = `<div class="card card-pad empty"><b>No encontramos esa orden.</b><br>Revisá que el link esté completo o comunicate con nosotros.</div>`;
    return;
  }
  const e = estadoInfo(o.estado);
  const pos = ['repuesto', 'derivado'].includes(o.estado) ? 3 : o.estado === 'sin_reparacion' ? 4 : FLUJO.indexOf(o.estado);
  const ultimo = [...o.historial].reverse().find(h => h.estado === o.estado && h.comentario && !esRespuestaCliente(h.comentario));
  const n = o.negocio;
  const wa = texto => n.whatsapp ? linkWhatsApp(n.whatsapp, texto) : '';
  const pendiente = o.estado === 'presupuesto' && o.presupuesto != null && o.presupuesto_aprobado == null;
  document.title = `Orden #${o.numero} — ${e.label}`;

  let bloquePresu = '';
  if (o.presupuesto != null && ['presupuesto', 'reparacion', 'derivado', 'repuesto', 'listo'].includes(o.estado)) {
    bloquePresu = `<div style="margin-top:1.2rem" class="small muted">Presupuesto</div><div style="font-size:1.5rem;font-weight:700">${money(o.presupuesto)}</div>`;
    if (pendiente) bloquePresu += `
      <div class="row" style="margin-top:1rem;gap:.6rem">
        <button class="btn ok lg" id="aceptar">✓ Acepto el presupuesto</button>
        <button class="btn lg" id="rechazar">No, gracias</button>
      </div>
      <div class="small muted" style="margin-top:.5rem">Si tenés dudas, escribinos antes de responder.</div>`;
    else if (o.estado === 'presupuesto' && o.presupuesto_aprobado === true) bloquePresu += `<div style="margin-top:.6rem"><span class="pill green">✓ Aceptaste el presupuesto</span></div>`;
    else if (o.estado === 'presupuesto' && o.presupuesto_aprobado === false) bloquePresu += `<div style="margin-top:.6rem"><span class="pill red">Rechazaste el presupuesto</span></div>`;
  }
  if (o.anticipo_pagado > 0) {
    bloquePresu += `<div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--line)">
      <div class="small muted">Pagaste a cuenta</div><div style="font-size:1.3rem;font-weight:700;color:var(--ok)">${money(o.anticipo_pagado)}</div>
      ${o.saldo_pendiente > 0 ? `<div class="small muted" style="margin-top:.3rem">Saldo pendiente: <b>${money(o.saldo_pendiente)}</b></div>` : `<div class="small" style="margin-top:.3rem;color:var(--ok)">✓ No tenés saldo pendiente</div>`}
    </div>`;
  }

  const waConsulta = wa(`Hola! Consulto por mi orden #${o.numero} (${o.equipo}).`);
  app.innerHTML = `
  <div class="card status">
    <div class="num">Hola ${esc(o.cliente)} · Orden #${o.numero}</div>
    <div class="eq">${esc(o.equipo)}</div>
    <div class="stepper">${FLUJO.map((s, i) => {
      let label = estadoInfo(s).label;
      if (i === pos && ['repuesto', 'derivado'].includes(o.estado)) label = estadoInfo(o.estado).label;
      if (i === pos && o.estado === 'sin_reparacion') label = 'Sin reparación';
      return `<div class="step ${i < pos ? 'done' : ''} ${i === pos ? 'current' : ''}">${esc(label)}</div>`;
    }).join('')}</div>
    <div class="big big-${e.color}">${esc(e.label)}</div>
    <div class="msg">${esc(ultimo?.comentario || e.cliente)}</div>
    ${bloquePresu}
    ${o.fecha_estimada && !['listo', 'entregado', 'sin_reparacion'].includes(o.estado) ? `<div class="small muted" style="margin-top:.8rem">Fecha estimada: <b>${fdate(o.fecha_estimada)}</b></div>` : ''}
    ${waConsulta ? `<a class="btn wa block" style="margin-top:1.2rem" href="${waConsulta}" target="_blank" rel="noopener">💬 Escribinos por WhatsApp</a>` : ''}
  </div>
  <div class="card card-pad"><h2>Novedades</h2><div class="timeline">
    ${[...o.historial].reverse().map(h => `<div class="tl-item"><div class="when">${fdatetime(h.fecha)}</div><div class="what">${esc(estadoInfo(h.estado).label)}</div>${h.comentario ? `<div class="detail">${esc(h.comentario)}</div>` : ''}</div>`).join('')}
  </div>
  <div class="small muted" style="margin-top:.3rem">Falla informada: ${esc(o.falla)}</div></div>
  <div class="card card-pad"><h2>${esc(n.nombre)}</h2>
    <div class="small" style="line-height:1.7">${esc(n.direccion)}${n.telefono ? `<br>Tel: ${esc(n.telefono)}` : ''}${n.horario ? `<br><span class="muted">${esc(n.horario)}</span>` : ''}</div>
  </div>`;

  if (pendiente) {
    const responder = async acepta => {
      const msg = acepta ? `¿Confirmás que aceptás el presupuesto de ${money(o.presupuesto)}?` : '¿Confirmás que NO querés hacer la reparación?';
      if (!confirm(msg)) return;
      $$btns().forEach(b => b.disabled = true);
      try {
        const nuevo = await store.responderPresupuesto(token, acepta);
        render(nuevo);
        const texto = acepta ? `Hola! Acepté el presupuesto de la orden #${o.numero} (${o.equipo}).` : `Hola! Rechacé el presupuesto de la orden #${o.numero} (${o.equipo}).`;
        const link = wa(texto);
        app.insertAdjacentHTML('afterbegin', `<div class="card card-pad" style="text-align:center;margin-bottom:.8rem">
          <b>${acepta ? '¡Gracias! Registramos tu aprobación.' : 'Registramos tu respuesta.'}</b>
          ${link ? `<div class="small muted" style="margin:.3rem 0 .8rem">Si querés, avisanos también por WhatsApp:</div><a class="btn wa block" href="${link}" target="_blank" rel="noopener">Avisar por WhatsApp</a>` : ''}</div>`);
        window.scrollTo(0, 0);
      } catch (err) {
        alert(err.message || 'No se pudo registrar la respuesta. Intentá de nuevo.');
        $$btns().forEach(b => b.disabled = false);
      }
    };
    const $$btns = () => [document.getElementById('aceptar'), document.getElementById('rechazar')].filter(Boolean);
    document.getElementById('aceptar').onclick = () => responder(true);
    document.getElementById('rechazar').onclick = () => responder(false);
  }
}

render(token ? await store.seguimiento(token).catch(() => null) : null);
