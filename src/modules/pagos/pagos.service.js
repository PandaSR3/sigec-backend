const { withTransaction, pool } = require('../../config/db');
const { registrarAuditoria } = require('../../utils/auditoria');

// IDs fijos segun el orden de insercion en sigec_seed.sql
const ID_ESTADO_PAGO_REGISTRADO = 1;
const ID_ESTADO_CUOTA_PENDIENTE = 1;
const ID_ESTADO_CUOTA_PARCIAL = 2;
const ID_ESTADO_CUOTA_PAGADA = 3;
const ID_ESTADO_CREDITO_DISPONIBLE = 1;
const ID_TIPO_MOVIMIENTO_PAGO = 2;

/**
 * Registra un pago y lo aplica automaticamente contra las cuotas
 * pendientes del contrato, en orden de vencimiento (FIFO), tal como
 * describe el proceso REGISTRAR PAGO del Documento 03.
 *
 * Si el monto excede el total pendiente, el sobrante genera un
 * credito a favor de la persona (RG-060) en vez de perderse.
 *
 * Recibe el `client` de una transaccion ya abierta, para poder
 * combinarse atomicamente con otras operaciones (ver creditos.service.js).
 */
async function _registrarConClient(client, idContrato, { monto, idFormaPago, referencia, idRemesaPlanilla, observaciones }, idUsuarioCreador) {
  if (!(monto > 0)) {
    const err = new Error('El monto del pago debe ser mayor a cero');
    err.status = 400;
    throw err;
  }

  const { rows: contratoRows } = await client.query(
    'SELECT * FROM contrato WHERE id_contrato = $1 FOR UPDATE', [idContrato]
  );
  if (contratoRows.length === 0) {
    const err = new Error('Contrato no encontrado');
    err.status = 404;
    throw err;
  }
  const contrato = contratoRows[0];

  // 1) Registrar el pago como movimiento independiente (RG-040)
  const { rows: pagoRows } = await client.query(
    `INSERT INTO pago (id_contrato, id_forma_pago, id_estado_pago, monto, referencia, id_remesa_planilla, observaciones, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [idContrato, idFormaPago, ID_ESTADO_PAGO_REGISTRADO, monto, referencia || null,
      idRemesaPlanilla || null, observaciones || null, idUsuarioCreador]
  );
  const pago = pagoRows[0];

  // 2) Cuotas con saldo pendiente, ordenadas por vencimiento (FIFO).
  //    El saldo de cada cuota se calcula dinamicamente: nunca se
  //    guarda en la cuota (Entidad 003, doc 06).
  const { rows: cuotasPendientes } = await client.query(
    `SELECT cu.id_cuota, cu.monto_programado,
            cu.monto_programado - COALESCE(SUM(ap.monto_aplicado), 0) AS saldo
       FROM cuota cu
       JOIN cronograma cr ON cr.id_cronograma = cu.id_cronograma
       LEFT JOIN aplicacion_pago ap ON ap.id_cuota = cu.id_cuota
      WHERE cr.id_contrato = $1
        AND cu.id_estado_cuota IN ($2, $3)
      GROUP BY cu.id_cuota, cu.monto_programado, cu.numero_cuota
     HAVING cu.monto_programado - COALESCE(SUM(ap.monto_aplicado), 0) > 0
      ORDER BY cu.numero_cuota`,
    [idContrato, ID_ESTADO_CUOTA_PENDIENTE, ID_ESTADO_CUOTA_PARCIAL]
  );

  let restante = Number(monto);
  const cuotasActualizadas = [];

  for (const cuota of cuotasPendientes) {
    if (restante <= 0) break;
    const saldoCuota = Number(cuota.saldo);
    const aAplicar = Math.min(restante, saldoCuota);

    await client.query(
      `INSERT INTO aplicacion_pago (id_pago, id_cuota, monto_aplicado)
       VALUES ($1,$2,$3)`,
      [pago.id_pago, cuota.id_cuota, aAplicar]
    );

    const nuevoSaldo = Math.round((saldoCuota - aAplicar) * 100) / 100;
    const nuevoEstado = nuevoSaldo <= 0 ? ID_ESTADO_CUOTA_PAGADA : ID_ESTADO_CUOTA_PARCIAL;

    await client.query('UPDATE cuota SET id_estado_cuota = $1, updated_at = now() WHERE id_cuota = $2',
      [nuevoEstado, cuota.id_cuota]);

    cuotasActualizadas.push({ idCuota: cuota.id_cuota, aplicado: aAplicar, nuevoSaldo });
    restante = Math.round((restante - aAplicar) * 100) / 100;
  }

  // 3) Si sobra dinero tras cubrir todas las cuotas pendientes, se
  //    genera un credito a favor (RG-060/061), nunca se descarta.
  let credito = null;
  if (restante > 0) {
    const { rows: creditoRows } = await client.query(
      `INSERT INTO credito (id_persona, id_contrato_origen, id_pago_origen, monto_original, monto_disponible, id_estado_credito, motivo, created_by)
       VALUES ($1,$2,$3,$4,$4,$5,'Excedente de pago sobre saldo pendiente',$6)
       RETURNING *`,
      [contrato.id_persona, idContrato, pago.id_pago, restante, ID_ESTADO_CREDITO_DISPONIBLE, idUsuarioCreador]
    );
    credito = creditoRows[0];
  }

  // 4) Libro Mayor: el pago reduce el saldo del contrato (Regla 2, Arquitectura v1.0)
  const { rows: saldoRows } = await client.query(
    `SELECT COALESCE(SUM(debito),0) - COALESCE(SUM(credito_monto),0) AS saldo
       FROM movimiento_financiero WHERE id_contrato = $1`,
    [idContrato]
  );
  const saldoAnterior = Number(saldoRows[0].saldo);
  const saldoNuevo = Math.round((saldoAnterior - Number(monto)) * 100) / 100;

  await client.query(
    `INSERT INTO movimiento_financiero
       (id_contrato, id_tipo_movimiento_financiero, id_pago, debito, credito_monto, saldo_resultante, descripcion, created_by)
     VALUES ($1,$2,$3,0,$4,$5,'Pago registrado',$6)`,
    [idContrato, ID_TIPO_MOVIMIENTO_PAGO, pago.id_pago, monto, saldoNuevo, idUsuarioCreador]
  );

  // 5) Auditoria (RG-047)
  await registrarAuditoria(client, {
    idUsuario: idUsuarioCreador,
    tablaAfectada: 'pago',
    idRegistroAfectado: pago.id_pago,
    accion: 'CREAR',
    estadoNuevo: pago
  });

  return { pago, cuotasActualizadas, credito, saldoContrato: saldoNuevo };
}

async function registrar(idContrato, data, idUsuarioCreador) {
  return withTransaction((client) => _registrarConClient(client, idContrato, data, idUsuarioCreador));
}

// Para cuando otro modulo (ej. creditos) ya tiene una transaccion abierta
// y necesita que el pago quede atomico junto con sus propias operaciones.
async function registrarConClient(client, idContrato, data, idUsuarioCreador) {
  return _registrarConClient(client, idContrato, data, idUsuarioCreador);
}

async function listarPorContrato(idContrato) {
  const { rows } = await pool.query(
    `SELECT p.*, fp.nombre AS forma_pago
       FROM pago p
       JOIN forma_pago fp ON fp.id_forma_pago = p.id_forma_pago
      WHERE p.id_contrato = $1
      ORDER BY p.fecha_pago DESC`,
    [idContrato]
  );
  return rows;
}

module.exports = { registrar, registrarConClient, listarPorContrato };
