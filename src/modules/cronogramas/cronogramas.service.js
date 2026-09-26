const { withTransaction, pool } = require('../../config/db');
const { registrarAuditoria } = require('../../utils/auditoria');
const { generarCuotas } = require('../../utils/cuotas');

// IDs fijos segun el orden de insercion en sigec_seed.sql
const ID_ESTADO_CRONOGRAMA_ACTIVO = 1;
const ID_ESTADO_CRONOGRAMA_REPROGRAMADO = 2;
const ID_ESTADO_CUOTA_PENDIENTE = 1;
const ID_ESTADO_CUOTA_PARCIAL = 2;
const ID_ESTADO_CUOTA_ANULADA = 5;

/**
 * RG-030 / Entidad 002 (doc 06): reprograma el saldo pendiente de un
 * contrato en un cronograma nuevo. El cronograma anterior NUNCA se
 * elimina, solo cambia a estado "Reprogramado" y queda enlazado via
 * id_cronograma_anterior. Las cuotas ya pagadas conservan su historial
 * intacto; las que todavia tenian saldo pasan a "Anulada" (tampoco se
 * borran, RG-033) porque ese saldo se traslada al cronograma nuevo.
 */
async function reprogramar(idContrato, { numeroCuotas, fechaPrimerVencimiento, motivo }, idUsuario) {
  if (!(numeroCuotas > 0)) { const err = new Error('numeroCuotas debe ser mayor a cero'); err.status = 400; throw err; }
  if (!fechaPrimerVencimiento) { const err = new Error('fechaPrimerVencimiento es requerida'); err.status = 400; throw err; }
  if (!motivo) { const err = new Error('El motivo de la reprogramacion es requerido'); err.status = 400; throw err; }

  return withTransaction(async (client) => {
    const { rows: cronogramaRows } = await client.query(
      `SELECT * FROM cronograma WHERE id_contrato = $1 AND id_estado_cronograma = $2
       ORDER BY id_cronograma DESC LIMIT 1 FOR UPDATE`,
      [idContrato, ID_ESTADO_CRONOGRAMA_ACTIVO]
    );
    if (cronogramaRows.length === 0) {
      const err = new Error('El contrato no tiene un cronograma activo para reprogramar'); err.status = 400; throw err;
    }
    const cronogramaActual = cronogramaRows[0];

    const { rows: cuotasPendientes } = await client.query(
      `SELECT cu.id_cuota, cu.monto_programado - COALESCE(SUM(ap.monto_aplicado),0) AS saldo
         FROM cuota cu
         LEFT JOIN aplicacion_pago ap ON ap.id_cuota = cu.id_cuota
        WHERE cu.id_cronograma = $1 AND cu.id_estado_cuota IN ($2, $3)
        GROUP BY cu.id_cuota, cu.monto_programado
       HAVING cu.monto_programado - COALESCE(SUM(ap.monto_aplicado),0) > 0`,
      [cronogramaActual.id_cronograma, ID_ESTADO_CUOTA_PENDIENTE, ID_ESTADO_CUOTA_PARCIAL]
    );

    const saldoTotal = Math.round(cuotasPendientes.reduce((acc, c) => acc + Number(c.saldo), 0) * 100) / 100;
    if (saldoTotal <= 0) {
      const err = new Error('No hay saldo pendiente en este contrato para reprogramar'); err.status = 400; throw err;
    }

    // Las cuotas con saldo quedan Anuladas (nunca eliminadas): su deuda
    // se traslada integra al cronograma nuevo.
    for (const c of cuotasPendientes) {
      await client.query('UPDATE cuota SET id_estado_cuota = $1, updated_at = now() WHERE id_cuota = $2',
        [ID_ESTADO_CUOTA_ANULADA, c.id_cuota]);
    }

    await client.query(
      'UPDATE cronograma SET id_estado_cronograma = $1 WHERE id_cronograma = $2',
      [ID_ESTADO_CRONOGRAMA_REPROGRAMADO, cronogramaActual.id_cronograma]
    );

    const { rows: nuevoCronogramaRows } = await client.query(
      `INSERT INTO cronograma (id_contrato, id_estado_cronograma, id_cronograma_anterior, motivo_reprogramacion, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [idContrato, ID_ESTADO_CRONOGRAMA_ACTIVO, cronogramaActual.id_cronograma, motivo, idUsuario]
    );
    const nuevoCronograma = nuevoCronogramaRows[0];

    const cuotasCalculadas = generarCuotas(saldoTotal, numeroCuotas, fechaPrimerVencimiento);
    for (const c of cuotasCalculadas) {
      await client.query(
        `INSERT INTO cuota (id_cronograma, numero_cuota, fecha_vencimiento, monto_programado, id_estado_cuota)
         VALUES ($1,$2,$3,$4,$5)`,
        [nuevoCronograma.id_cronograma, c.numero, c.fecha, c.monto, ID_ESTADO_CUOTA_PENDIENTE]
      );
    }

    await registrarAuditoria(client, {
      idUsuario, tablaAfectada: 'cronograma', idRegistroAfectado: nuevoCronograma.id_cronograma,
      accion: 'CREAR',
      estadoAnterior: { id_cronograma_anterior: cronogramaActual.id_cronograma, saldo_trasladado: saldoTotal },
      estadoNuevo: nuevoCronograma,
      observaciones: motivo
    });

    return { cronogramaAnterior: cronogramaActual.id_cronograma, cronogramaNuevo: nuevoCronograma, saldoTrasladado: saldoTotal, cuotas: cuotasCalculadas };
  });
}

/**
 * Historial completo de cronogramas de un contrato (el activo y los
 * reprogramados), cada uno con sus cuotas, para que quede visible la
 * trazabilidad completa (RG-003).
 */
async function historial(idContrato) {
  const { rows: cronogramas } = await pool.query(
    `SELECT cr.*, ec.nombre AS estado
       FROM cronograma cr JOIN estado_cronograma ec ON ec.id_estado_cronograma = cr.id_estado_cronograma
      WHERE cr.id_contrato = $1
      ORDER BY cr.id_cronograma`,
    [idContrato]
  );

  for (const cr of cronogramas) {
    const { rows: cuotas } = await pool.query(
      `SELECT cu.*, ecu.nombre AS estado
         FROM cuota cu JOIN estado_cuota ecu ON ecu.id_estado_cuota = cu.id_estado_cuota
        WHERE cu.id_cronograma = $1
        ORDER BY cu.numero_cuota`,
      [cr.id_cronograma]
    );
    cr.cuotas = cuotas;
  }

  return cronogramas;
}

module.exports = { reprogramar, historial };
