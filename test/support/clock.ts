// El reloj de prueba vive con los dobles de identidad; se re-exporta acá para los E2E que solo
// necesitan controlar la hora (por ejemplo, `createApp({ clock: new FixedClock() })`).
export { FIXED_NOW, FixedClock } from './identity'
