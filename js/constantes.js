// Constantes compartidas por la app, la página de seguimiento y las capas de datos.

export const ESTADOS = [
  { id: 'recibido',       label: 'Recibido',            color: 'gray',   cliente: 'Recibimos tu equipo.' },
  { id: 'diagnostico',    label: 'En diagnóstico',      color: 'blue',   cliente: 'Un técnico está revisando tu equipo.' },
  { id: 'presupuesto',    label: 'Presupuesto enviado', color: 'amber',  cliente: 'Te enviamos el presupuesto. Esperamos tu confirmación.' },
  { id: 'reparacion',     label: 'En reparación',       color: 'blue',   cliente: 'Tu equipo está siendo reparado.' },
  { id: 'repuesto',       label: 'Esperando repuesto',  color: 'violet', cliente: 'Estamos esperando un repuesto para continuar.' },
  { id: 'listo',          label: 'Listo para retirar',  color: 'green',  cliente: '¡Tu equipo está listo! Podés pasar a retirarlo.' },
  { id: 'entregado',      label: 'Entregado',           color: 'gray',   cliente: 'Equipo entregado. ¡Gracias por confiar en nosotros!' },
  { id: 'sin_reparacion', label: 'Sin reparación',      color: 'red',    cliente: 'El equipo no pudo ser reparado. Podés pasar a retirarlo.' },
];
export const estadoInfo = id => ESTADOS.find(e => e.id === id) || ESTADOS[0];
export const FORMAS_PAGO = ['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'Mercado Pago'];
export const CONDICIONES_IVA = ['Consumidor Final', 'Responsable Inscripto', 'Monotributo', 'Exento', 'No Responsable'];
export const TIPOS_EQUIPO = ['Notebook', 'PC de escritorio', 'All in One', 'Celular', 'Tablet', 'Impresora', 'Monitor', 'Consola', 'Otro'];
// Deja la venta o el service como deuda del cliente (Fichero) en vez de entrar a caja
export const CUENTA_CORRIENTE = 'Cuenta corriente';
export const FORMAS_COBRO = [...FORMAS_PAGO, CUENTA_CORRIENTE];
