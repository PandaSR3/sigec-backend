const { Pool } = require('pg');

// Neon exige SSL. Si la URL apunta a localhost (desarrollo), lo desactivamos
// para no pelear con certificados locales.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  // Errores de conexiones ociosas en el pool: no deben tumbar el proceso.
  console.error('Error inesperado en el pool de Postgres:', err.message);
});

/**
 * Ejecuta una funcion dentro de una transaccion.
 * Uso: await withTransaction(async (client) => { ... });
 * Si el callback lanza, se hace ROLLBACK automatico (RG-004: la info
 * financiera nunca queda a medias).
 */
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
