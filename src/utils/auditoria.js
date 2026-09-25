/**
 * RG-080: toda operacion importante debe registrarse automaticamente.
 * RG-081: la auditoria nunca podra ser modificada manualmente (solo insert).
 *
 * Se usa siempre con el mismo client de la transaccion de negocio, para
 * que la auditoria quede o no quede junto con el resto de la operacion.
 */
async function registrarAuditoria(client, {
  idUsuario,
  tablaAfectada,
  idRegistroAfectado,
  accion,
  estadoAnterior = null,
  estadoNuevo = null,
  observaciones = null
}) {
  await client.query(
    `INSERT INTO auditoria
       (id_usuario, tabla_afectada, id_registro_afectado, accion, estado_anterior, estado_nuevo, observaciones)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      idUsuario,
      tablaAfectada,
      idRegistroAfectado,
      accion,
      estadoAnterior ? JSON.stringify(estadoAnterior) : null,
      estadoNuevo ? JSON.stringify(estadoNuevo) : null,
      observaciones
    ]
  );
}

module.exports = { registrarAuditoria };
