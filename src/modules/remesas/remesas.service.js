const { withTransaction, pool } = require('../../config/db');
const { registrarAuditoria } = require('../../utils/auditoria');
const pagosService = require('../pagos/pagos.service');

// IDs fijos segun el orden de insercion en sigec_seed.sql
const ID_MODALIDAD_PLANILLA = 1;
const ID_ESTADO_CUOTA_PENDIENTE = 1;
const ID_ESTADO_CUOTA_PARCIAL = 2;
const ID_FORMA_PAGO_PLANILLA = 7;

const ID_ESTADO_REMESA_GENERADA = 2;
const ID_ESTADO_REMESA_ENVIADA = 3;
const ID_ESTADO_REMESA_PROCESADA = 4;
const ID_ESTADO_REMESA_OBSERVADA = 5;
const ID_ESTADO_REMESA_RECHAZADA = 6;
const ID_ESTADO_REMESA_CERRADA = 7;

/**
 * RN-007/RG-050: genera automaticamente una remesa con todas las cuotas
 * pendientes o parciales de contratos en modalidad "Descuento por Planilla"
 * cuyo vencimiento cae dentro del periodo indicado (formato 'YYYY-MM'),
 * y que no esten ya incluidas en otra remesa activa.
 */
async function generar(idEmpresa, periodo, idUsuarioCreador) {
  return withTransaction(async (client) => {
    const { rows: remesaRows } = await client.query(
      `INSERT INTO remesa_planilla (id_empresa, id_estado_remesa, periodo, created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [idEmpresa, ID_ESTADO_REMESA_GENERADA, periodo, idUsuarioCreador]
    );
    const remesa = remesaRows[0];

    // Cuotas elegibles: contrato en modalidad planilla, con saldo pendiente,
    // que vencen dentro o antes del periodo, y que NO esten ya en una
    // remesa activa (Generada/Enviada/Procesada) para no duplicar el descuento.
    const { rows: cuotasElegibles } = await client.query(
      `SELECT cu.id_cuota,
              cu.monto_programado - COALESCE(SUM(ap.monto_aplicado), 0) AS saldo
         FROM cuota cu
         JOIN cronograma cr ON cr.id_cronograma = cu.id_cronograma
         JOIN contrato c ON c.id_contrato = cr.id_contrato
         LEFT JOIN aplicacion_pago ap ON ap.id_cuota = cu.id_cuota
        WHERE c.id_empresa = $1
          AND c.id_modalidad_cobranza = $2
          AND cu.id_estado_cuota IN ($3, $4)
          AND cu.fecha_vencimiento <= (to_date($5, 'YYYY-MM') + INTERVAL '1 month' - INTERVAL '1 day')
          AND cu.id_cuota NOT IN (
                SELECT rpc.id_cuota FROM remesa_planilla_cuota rpc
                  JOIN remesa_planilla rp ON rp.id_remesa_planilla = rpc.id_remesa_planilla
                 WHERE rp.id_estado_remesa IN ($6, $7, $8)
                   AND rpc.fue_excluida = FALSE
              )
        GROUP BY cu.id_cuota, cu.monto_programado
       HAVING cu.monto_programado - COALESCE(SUM(ap.monto_aplicado), 0) > 0`,
      [idEmpresa, ID_MODALIDAD_PLANILLA, ID_ESTADO_CUOTA_PENDIENTE, ID_ESTADO_CUOTA_PARCIAL,
        periodo, ID_ESTADO_REMESA_GENERADA, ID_ESTADO_REMESA_ENVIADA, ID_ESTADO_REMESA_PROCESADA]
    );

    for (const cuota of cuotasElegibles) {
      await client.query(
        `INSERT INTO remesa_planilla_cuota (id_remesa_planilla, id_cuota, monto_incluido)
         VALUES ($1,$2,$3)`,
        [remesa.id_remesa_planilla, cuota.id_cuota, cuota.saldo]
      );
    }

    await registrarAuditoria(client, {
      idUsuario: idUsuarioCreador,
      tablaAfectada: 'remesa_planilla',
      idRegistroAfectado: remesa.id_remesa_planilla,
      accion: 'CREAR',
      estadoNuevo: remesa,
      observaciones: `Generada con ${cuotasElegibles.length} cuota(s)`
    });

    return { remesa, totalCuotas: cuotasElegibles.length };
  });
}

/**
 * RN-052 / Regla 4: mientras la remesa siga en Borrador/Generada (aun no
 * enviada), si alguna de sus cuotas fue pagada -total o parcialmente- por
 * fuera de la planilla, se excluye o se ajusta el monto antes de enviarla.
 * Una vez "Enviada" ya no se toca (el descuento se asume comunicado).
 */
async function refrescar(idRemesa, idUsuario) {
  return withTransaction(async (client) => {
    const { rows: remesaRows } = await client.query(
      'SELECT * FROM remesa_planilla WHERE id_remesa_planilla = $1 FOR UPDATE', [idRemesa]
    );
    if (remesaRows.length === 0) {
      const err = new Error('Remesa no encontrada'); err.status = 404; throw err;
    }
    const remesa = remesaRows[0];
    if (remesa.id_estado_remesa !== ID_ESTADO_REMESA_GENERADA) {
      const err = new Error('Solo se puede refrescar una remesa en estado Generada (aun no enviada)');
      err.status = 400; throw err;
    }

    const { rows: items } = await client.query(
      `SELECT rpc.id_remesa_planilla_cuota, rpc.id_cuota, rpc.monto_incluido,
              cu.monto_programado - COALESCE(SUM(ap.monto_aplicado), 0) AS saldo_actual
         FROM remesa_planilla_cuota rpc
         JOIN cuota cu ON cu.id_cuota = rpc.id_cuota
         LEFT JOIN aplicacion_pago ap ON ap.id_cuota = cu.id_cuota
        WHERE rpc.id_remesa_planilla = $1 AND rpc.fue_excluida = FALSE
        GROUP BY rpc.id_remesa_planilla_cuota, rpc.id_cuota, rpc.monto_incluido, cu.monto_programado`,
      [idRemesa]
    );

    let excluidas = 0, ajustadas = 0;
    for (const item of items) {
      const saldo = Number(item.saldo_actual);
      if (saldo <= 0) {
        // RN-052: ya fue cancelada por fuera de la planilla, se excluye.
        await client.query(
          `UPDATE remesa_planilla_cuota
             SET fue_excluida = TRUE, motivo_exclusion = 'Cuota cancelada por pago directo antes de enviar la remesa'
           WHERE id_remesa_planilla_cuota = $1`,
          [item.id_remesa_planilla_cuota]
        );
        excluidas++;
      } else if (saldo !== Number(item.monto_incluido)) {
        // Pago parcial directo recibido: se ajusta el monto a descontar.
        await client.query(
          `UPDATE remesa_planilla_cuota SET monto_incluido = $1 WHERE id_remesa_planilla_cuota = $2`,
          [saldo, item.id_remesa_planilla_cuota]
        );
        ajustadas++;
      }
    }

    await registrarAuditoria(client, {
      idUsuario: idUsuario,
      tablaAfectada: 'remesa_planilla',
      idRegistroAfectado: idRemesa,
      accion: 'MODIFICAR',
      observaciones: `Refrescada: ${excluidas} cuota(s) excluida(s), ${ajustadas} ajustada(s)`
    });

    return { excluidas, ajustadas };
  });
}

async function enviar(idRemesa, idUsuario) {
  return cambiarEstado(idRemesa, idUsuario, ID_ESTADO_REMESA_GENERADA, ID_ESTADO_REMESA_ENVIADA,
    'fecha_envio', 'Remesa marcada como enviada a planillas');
}

async function observar(idRemesa, idUsuario, motivo) {
  return cambiarEstado(idRemesa, idUsuario, ID_ESTADO_REMESA_ENVIADA, ID_ESTADO_REMESA_OBSERVADA,
    null, motivo || 'Remesa observada');
}

async function rechazar(idRemesa, idUsuario, motivo) {
  return cambiarEstado(idRemesa, idUsuario, ID_ESTADO_REMESA_OBSERVADA, ID_ESTADO_REMESA_RECHAZADA,
    null, motivo || 'Remesa rechazada');
}

async function cambiarEstado(idRemesa, idUsuario, estadoEsperado, estadoNuevo, columnaFecha, observacion) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM remesa_planilla WHERE id_remesa_planilla = $1 FOR UPDATE', [idRemesa]
    );
    if (rows.length === 0) { const err = new Error('Remesa no encontrada'); err.status = 404; throw err; }
    const remesa = rows[0];
    if (remesa.id_estado_remesa !== estadoEsperado) {
      const err = new Error(`La remesa debe estar en el estado previo correspondiente para esta accion`);
      err.status = 400; throw err;
    }

    const setFecha = columnaFecha ? `, ${columnaFecha} = now()` : '';
    const { rows: updated } = await client.query(
      `UPDATE remesa_planilla SET id_estado_remesa = $1 ${setFecha} WHERE id_remesa_planilla = $2 RETURNING *`,
      [estadoNuevo, idRemesa]
    );

    await registrarAuditoria(client, {
      idUsuario, tablaAfectada: 'remesa_planilla', idRegistroAfectado: idRemesa,
      accion: 'MODIFICAR', estadoAnterior: remesa, estadoNuevo: updated[0], observaciones: observacion
    });

    return updated[0];
  });
}

/**
 * Marca la remesa como Procesada: significa que el descuento realmente
 * ocurrio en la planilla del docente. Para cada cuota no excluida, se
 * registra un pago via el motor de pagos normal (forma_pago = Planilla).
 * Si una cuota ya fue cubierta por otro medio entre el envio y el
 * procesamiento, el motor de pagos genera credito automaticamente en vez
 * de duplicar el cobro (Regla 4, Arquitectura v1.0) — no hace falta logica
 * extra aqui, es el mismo comportamiento que ya usa /pagos.
 */
async function procesar(idRemesa, idUsuario) {
  const { rows: remesaRows } = await pool.query(
    'SELECT * FROM remesa_planilla WHERE id_remesa_planilla = $1', [idRemesa]
  );
  if (remesaRows.length === 0) { const err = new Error('Remesa no encontrada'); err.status = 404; throw err; }
  const remesa = remesaRows[0];
  if (remesa.id_estado_remesa !== ID_ESTADO_REMESA_ENVIADA) {
    const err = new Error('Solo se puede procesar una remesa en estado Enviada');
    err.status = 400; throw err;
  }

  const { rows: items } = await pool.query(
    `SELECT rpc.id_cuota, rpc.monto_incluido, cr.id_contrato
       FROM remesa_planilla_cuota rpc
       JOIN cuota cu ON cu.id_cuota = rpc.id_cuota
       JOIN cronograma cr ON cr.id_cronograma = cu.id_cronograma
      WHERE rpc.id_remesa_planilla = $1 AND rpc.fue_excluida = FALSE`,
    [idRemesa]
  );

  const resultados = [];
  for (const item of items) {
    // Un pago por contrato afectado, referenciando esta remesa.
    const resultado = await pagosService.registrar(item.id_contrato, {
      monto: Number(item.monto_incluido),
      idFormaPago: ID_FORMA_PAGO_PLANILLA,
      referencia: `Remesa ${idRemesa}`,
      idRemesaPlanilla: idRemesa,
      observaciones: 'Descuento por planilla procesado'
    }, idUsuario);
    resultados.push(resultado);
  }

  const actualizada = await cambiarEstado(idRemesa, idUsuario, ID_ESTADO_REMESA_ENVIADA,
    ID_ESTADO_REMESA_PROCESADA, 'fecha_procesado', `Procesada: ${items.length} pago(s) aplicados`);

  return { remesa: actualizada, pagosGenerados: resultados.length, creditosGenerados: resultados.filter((r) => r.credito).length };
}

async function obtener(idRemesa) {
  const { rows: remesaRows } = await pool.query(
    'SELECT * FROM remesa_planilla WHERE id_remesa_planilla = $1', [idRemesa]
  );
  if (remesaRows.length === 0) return null;

  const { rows: cuotas } = await pool.query(
    `SELECT rpc.*, cu.numero_cuota, cu.fecha_vencimiento, p.nombres_apellidos, c.numero_contrato
       FROM remesa_planilla_cuota rpc
       JOIN cuota cu ON cu.id_cuota = rpc.id_cuota
       JOIN cronograma cr ON cr.id_cronograma = cu.id_cronograma
       JOIN contrato c ON c.id_contrato = cr.id_contrato
       JOIN persona p ON p.id_persona = c.id_persona
      WHERE rpc.id_remesa_planilla = $1
      ORDER BY p.nombres_apellidos`,
    [idRemesa]
  );

  return { remesa: remesaRows[0], cuotas };
}

async function listar(idEmpresa) {
  const { rows } = await pool.query(
    `SELECT rp.*, er.nombre AS estado
       FROM remesa_planilla rp
       JOIN estado_remesa er ON er.id_estado_remesa = rp.id_estado_remesa
      WHERE rp.id_empresa = $1
      ORDER BY rp.fecha_generacion DESC`,
    [idEmpresa]
  );
  return rows;
}

module.exports = { generar, refrescar, enviar, observar, rechazar, procesar, obtener, listar };
