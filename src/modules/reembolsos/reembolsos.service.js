const { withTransaction, pool } = require('../../config/db');
const { registrarAuditoria } = require('../../utils/auditoria');

const ID_ESTADO_REEMBOLSO_SOLICITADO = 1;
const ID_ESTADO_REEMBOLSO_APROBADO = 2;
const ID_ESTADO_REEMBOLSO_PAGADO = 3;
const ID_ESTADO_REEMBOLSO_RECHAZADO = 4;

const ID_ESTADO_CREDITO_DISPONIBLE = 1;
const ID_ESTADO_CREDITO_REEMBOLSADO = 3;

const ID_TIPO_MOVIMIENTO_REEMBOLSO = 6;

/**
 * RG-070: todo reembolso debe estar asociado a un credito disponible.
 * En este punto solo se "reserva" la intencion; el dinero del credito
 * no se descuenta hasta que el reembolso se marca como Pagado (paso
 * real de desembolso).
 */
async function solicitar(idCredito, { monto, motivo }, idUsuarioResponsable, idUsuarioCreador) {
  if (!(monto > 0)) { const err = new Error('El monto debe ser mayor a cero'); err.status = 400; throw err; }
  if (!motivo) { const err = new Error('El motivo es requerido (RG-070)'); err.status = 400; throw err; }

  return withTransaction(async (client) => {
    const { rows: creditoRows } = await client.query(
      'SELECT * FROM credito WHERE id_credito = $1 FOR UPDATE', [idCredito]
    );
    if (creditoRows.length === 0) { const err = new Error('Credito no encontrado'); err.status = 404; throw err; }
    const credito = creditoRows[0];

    if (credito.id_estado_credito !== ID_ESTADO_CREDITO_DISPONIBLE) {
      const err = new Error('El credito no esta disponible'); err.status = 400; throw err;
    }
    if (monto > Number(credito.monto_disponible)) {
      const err = new Error('El monto solicitado excede el saldo disponible del credito'); err.status = 400; throw err;
    }

    const { rows: reembolsoRows } = await client.query(
      `INSERT INTO reembolso (id_credito, id_estado_reembolso, monto, motivo, id_responsable)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [idCredito, ID_ESTADO_REEMBOLSO_SOLICITADO, monto, motivo, idUsuarioResponsable]
    );
    const reembolso = reembolsoRows[0];

    await registrarAuditoria(client, {
      idUsuario: idUsuarioCreador, tablaAfectada: 'reembolso', idRegistroAfectado: reembolso.id_reembolso,
      accion: 'CREAR', estadoNuevo: reembolso
    });

    return reembolso;
  });
}

async function aprobar(idReembolso, idUsuario) {
  return cambiarEstado(idReembolso, idUsuario, ID_ESTADO_REEMBOLSO_SOLICITADO, ID_ESTADO_REEMBOLSO_APROBADO, 'Reembolso aprobado');
}

async function rechazar(idReembolso, idUsuario, motivo) {
  return cambiarEstado(idReembolso, idUsuario, [ID_ESTADO_REEMBOLSO_SOLICITADO, ID_ESTADO_REEMBOLSO_APROBADO],
    ID_ESTADO_REEMBOLSO_RECHAZADO, motivo || 'Reembolso rechazado');
}

async function cambiarEstado(idReembolso, idUsuario, estadosEsperados, estadoNuevo, observacion) {
  const permitidos = Array.isArray(estadosEsperados) ? estadosEsperados : [estadosEsperados];
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM reembolso WHERE id_reembolso = $1 FOR UPDATE', [idReembolso]);
    if (rows.length === 0) { const err = new Error('Reembolso no encontrado'); err.status = 404; throw err; }
    const reembolso = rows[0];
    if (!permitidos.includes(reembolso.id_estado_reembolso)) {
      const err = new Error('El reembolso no esta en un estado valido para esta accion'); err.status = 400; throw err;
    }

    const { rows: updated } = await client.query(
      'UPDATE reembolso SET id_estado_reembolso = $1 WHERE id_reembolso = $2 RETURNING *',
      [estadoNuevo, idReembolso]
    );

    await registrarAuditoria(client, {
      idUsuario, tablaAfectada: 'reembolso', idRegistroAfectado: idReembolso, accion: 'MODIFICAR',
      estadoAnterior: reembolso, estadoNuevo: updated[0], observaciones: observacion
    });

    return updated[0];
  });
}

/**
 * RG-071/072: al pagar el reembolso se genera el movimiento financiero
 * real y se descuenta del credito. RG-062: esto nunca toca el historial
 * de pagos original, solo agrega un nuevo movimiento (el dinero nunca
 * desaparece, Regla 3 de la Arquitectura v1.0).
 */
async function pagar(idReembolso, idUsuario) {
  return withTransaction(async (client) => {
    const { rows: reembolsoRows } = await client.query(
      'SELECT * FROM reembolso WHERE id_reembolso = $1 FOR UPDATE', [idReembolso]
    );
    if (reembolsoRows.length === 0) { const err = new Error('Reembolso no encontrado'); err.status = 404; throw err; }
    const reembolso = reembolsoRows[0];
    if (reembolso.id_estado_reembolso !== ID_ESTADO_REEMBOLSO_APROBADO) {
      const err = new Error('El reembolso debe estar Aprobado antes de pagarse'); err.status = 400; throw err;
    }

    const { rows: creditoRows } = await client.query(
      'SELECT * FROM credito WHERE id_credito = $1 FOR UPDATE', [reembolso.id_credito]
    );
    const credito = creditoRows[0];
    const monto = Number(reembolso.monto);

    if (monto > Number(credito.monto_disponible)) {
      const err = new Error('El credito ya no tiene saldo suficiente para este reembolso'); err.status = 400; throw err;
    }

    const nuevoDisponible = Math.round((Number(credito.monto_disponible) - monto) * 100) / 100;
    const nuevoEstadoCredito = nuevoDisponible <= 0 ? ID_ESTADO_CREDITO_REEMBOLSADO : ID_ESTADO_CREDITO_DISPONIBLE;
    await client.query('UPDATE credito SET monto_disponible = $1, id_estado_credito = $2 WHERE id_credito = $3',
      [nuevoDisponible, nuevoEstadoCredito, credito.id_credito]);

    // Libro Mayor del contrato de origen del credito: el dinero sale de
    // la empresa, asi que aumenta el saldo pendiente que ese credito
    // habia reducido antes (es un debito, como "Reembolso" en la
    // tabla de ejemplo de la Arquitectura v1.0).
    if (credito.id_contrato_origen) {
      const { rows: saldoRows } = await client.query(
        `SELECT COALESCE(SUM(debito),0) - COALESCE(SUM(credito_monto),0) AS saldo
           FROM movimiento_financiero WHERE id_contrato = $1`,
        [credito.id_contrato_origen]
      );
      const saldoNuevo = Math.round((Number(saldoRows[0].saldo) + monto) * 100) / 100;

      await client.query(
        `INSERT INTO movimiento_financiero
           (id_contrato, id_tipo_movimiento_financiero, id_reembolso, debito, credito_monto, saldo_resultante, descripcion, created_by)
         VALUES ($1,$2,$3,$4,0,$5,'Reembolso pagado',$6)`,
        [credito.id_contrato_origen, ID_TIPO_MOVIMIENTO_REEMBOLSO, idReembolso, monto, saldoNuevo, idUsuario]
      );
    }

    const { rows: updated } = await client.query(
      'UPDATE reembolso SET id_estado_reembolso = $1, fecha_procesado = now() WHERE id_reembolso = $2 RETURNING *',
      [ID_ESTADO_REEMBOLSO_PAGADO, idReembolso]
    );

    await registrarAuditoria(client, {
      idUsuario, tablaAfectada: 'reembolso', idRegistroAfectado: idReembolso, accion: 'MODIFICAR',
      estadoAnterior: reembolso, estadoNuevo: updated[0], observaciones: 'Reembolso pagado y descontado del credito'
    });

    return { reembolso: updated[0], creditoRestante: nuevoDisponible };
  });
}

async function obtener(idReembolso) {
  const { rows } = await pool.query(
    `SELECT r.*, er.nombre AS estado
       FROM reembolso r JOIN estado_reembolso er ON er.id_estado_reembolso = r.id_estado_reembolso
      WHERE r.id_reembolso = $1`,
    [idReembolso]
  );
  return rows[0] || null;
}

async function listarPorCredito(idCredito) {
  const { rows } = await pool.query(
    `SELECT r.*, er.nombre AS estado
       FROM reembolso r JOIN estado_reembolso er ON er.id_estado_reembolso = r.id_estado_reembolso
      WHERE r.id_credito = $1
      ORDER BY r.fecha_solicitud DESC`,
    [idCredito]
  );
  return rows;
}

module.exports = { solicitar, aprobar, rechazar, pagar, obtener, listarPorCredito };
