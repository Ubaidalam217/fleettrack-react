// In dev the Vite proxy forwards /flespi → https://flespi.io (avoids CORS).
// In production the browser calls Flespi directly (Flespi supports CORS).
export const BASE_URL = import.meta.env.DEV ? '/flespi' : 'https://flespi.io'

const FLESPI_TOKEN = import.meta.env.VITE_FLESPI_TOKEN
export const HEADERS = {
  'Authorization': `FlespiToken ${FLESPI_TOKEN}`,
  'Content-Type': 'application/json',
}
