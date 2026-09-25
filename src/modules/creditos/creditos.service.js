const { withTransaction, pool } = require('../../config/db');
const { registrarAuditoria } = require('../../utils/auditoria');
const { resolverIdCatalogo } = require('../../utils/catalogo');
const pagosService = require('../pagos/pagos.service');

const ID_ESTADO_CREDITO_DISPONIBLE = 1;
const ID_ESTADO_CREDITO_UTILIZADO = 2;

async function listarPorPersona(idPersona) {
  const { rows } = await pool.query(
    `SELECT cr.*, ec.nombre AS estado
       FROM credito cr JOIN estado_credito ec ON ec.id_estado_credito = cr.id_estado_credito
      WHERE cr.id_persona = $1
      ORDER BY cr.created_at DESC`,
    [idPersona]
  );
  return rows;
}

async function obtener(idCredito) {
  const { rows } = await pool.query(
    `SELECT cr.*, ec.nombre AS estado
       FROM credito cr JOIN estado_credito ec ON ec.id_estado_credito = cr.id_estado_credito
      WHERE cr.id_credito = $1`,
    [idCredito]
  );
  return rows[0] || null;
}

/**
 * RG-061: el credito puede usarse para cancelar cuotas futuras del mismo
 * contrato o de otro contrato del mismo alumno. Se aplica como un pago
 * mas (forma_pago = Credito) para reutilizar el motor ya probado en
 * /pagos: mismo FIFO contra cuotas pendientes, mismo Libro Mayor, misma
 * auditoria. RG-062: esto nunca modifica el historial de pagos previo.
 */
async function aplicar(idCredito, idContratoDestino, monto, idUsuario) {
  if (!(monto > 0)) {
    const err = new Error('El monto a aplicar debe ser mayor a cero'); err.status = 400; throw err;
  }

  const idFormaPagoCredito = await resolverIdCatalogo('forma_pago', 'id_forma_pago', 'Credito');

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
      const err = new Error('El monto excede el saldo disponible del credito'); err.status = 400; throw err;
    }

    const { rows: contratoRows } = await client.query(
      'SELECT id_persona FROM contrato WHERE id_contrato = $1', [idContratoDestino]
    );
    if (contratoRows.length === 0) { const err = new Error('Contrato destino no encontrado'); err.status = 404; throw err; }
    if (contratoRows[0].id_persona !== credito.id_persona) {
      const err = new Error('El contrato destino debe pertenecer a la misma persona titular del credito');
      err.status = 400; throw err;
    }

    // Aplica el credito como un pago normal (dentro de la misma
    // transaccion, usando el client actual para que quede todo atomico).
    const resultadoPago = await pagosService.registrarConClient(client, idContratoDestino, {
      monto,
      idFormaPago: idFormaPagoCredito,
      referencia: `Credito #${idCredito}`,
      observaciones: 'Aplicacion de credito a favor'
    }, idUsuario);

    await client.query(
      `INSERT INTO aplicacion_credito (id_credito, id_contrato_destino, monto_aplicado, created_by)
       VALUES ($1,$2,$3,$4)`,
      [idCredito, idContratoDestino, monto, idUsuario]
    );

    const nuevoDisponible = Math.round((Number(credito.monto_disponible) - monto) * 100) / 100;
    const nuevoEstado = nuevoDisponible <= 0 ? ID_ESTADO_CREDITO_UTILIZADO : ID_ESTADO_CREDITO_DISPONIBLE;
    await client.query(
      'UPDATE credito SET monto_disponible = $1, id_estado_credito = $2 WHERE id_credito = $3',
      [nuevoDisponible, nuevoEstado, idCredito]
    );

    await registrarAuditoria(client, {
      idUsuario, tablaAfectada: 'credito', idRegistroAfectado: idCredito, accion: 'MODIFICAR',
      estadoAnterior: { monto_disponible: credito.monto_disponible },
      estadoNuevo: { monto_disponible: nuevoDisponible },
      observaciones: `Aplicado S/${monto} al contrato ${idContratoDestino}`
    });

    return { creditoRestante: nuevoDisponible, pago: resultadoPago };
  });
}

module.exports = { listarPorPersona, obtener, aplicar };
