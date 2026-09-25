const { pool } = require('../config/db');

const cache = new Map();

/**
 * Resuelve el ID de una fila de catalogo por su nombre, sin asumir que
 * el orden de insercion del seed determina el ID (mas robusto que los
 * IDs fijos usados en otros modulos). Cachea en memoria porque los
 * catalogos casi nunca cambian en caliente.
 */
async function resolverIdCatalogo(tabla, columnaId, nombre) {
  const clave = `${tabla}:${nombre}`;
  if (cache.has(clave)) return cache.get(clave);

  const { rows } = await pool.query(
    `SELECT ${columnaId} AS id FROM ${tabla} WHERE nombre = $1`,
    [nombre]
  );
  if (rows.length === 0) {
    throw new Error(`No se encontro '${nombre}' en la tabla de catalogo ${tabla}`);
  }
  cache.set(clave, rows[0].id);
  return rows[0].id;
}

module.exports = { resolverIdCatalogo };
