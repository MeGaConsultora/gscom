// Elige la capa de datos: Supabase si está configurado, si no el modo demo.
import { SUPABASE_URL } from './config.js';

const mod = SUPABASE_URL ? await import('./store-supabase.js') : await import('./store-demo.js');

export const store = mod.store;
export const resetDemo = mod.resetDemo || (() => {});
export * from './constantes.js';
