const { withTransaction, pool } = require('../../config/db');
const { registrarAuditoria } = require('../../utils/auditoria');

// IDs fijos segun el orden de insercion en sigec_seed.sql
const ID_ESTADO_CONTRATO_REGISTRADO = 2;
const ID_ESTADO_CRONOGRAMA_ACTIVO = 1;
const ID_ESTADO_CUOTA_PENDIENTE = 1;
const ID_ESTADO_PROCESO_MATRICULA_REGISTRADA = 1;
const ID_TIPO_MOVIMIENTO_CONTRATO_GENERADO = 1;

function generarNumeroCuotas(totalContrato, numeroCuotas, fechaPrimerVencimiento) {
  // Reparte el total entre las cuotas. La ultima cuota absorbe el
  // redondeo para que la suma cuadre exactamente con total_contrato.
  const montoBase = Math.floor((totalContrato / numeroCuotas) * 100) / 100;
  const cuotas = [];
  let acumulado = 0;

  for (let i = 1; i <= numeroCuotas; i++) {
    const esUltima = i === numeroCuotas;
    const monto = esUltima ? Math.round((totalContrato - acumulado) * 100) / 100 : montoBase;
    acumulado += monto;

    const fecha = new Date(fechaPrimerVencimiento);
    fecha.setMonth(fecha.getMonth() + (i - 1));

    cuotas.push({ numero: i, monto, fecha: fecha.toISOString().slice(0, 10) });
  }
  return cuotas;
}

async function generarNumeroContrato(client, idEmpresa) {
  // Bloquea la fila de la empresa durante la transaccion para evitar que
  // dos contratos concurrentes generen el mismo numero.
  await client.query('SELECT id_empresa FROM empresa WHERE id_empresa = $1 FOR UPDATE', [idEmpresa]);
  const { rows } = await client.query(
    'SELECT count(*)::int AS total FROM contrato WHERE id_empresa = $1',
    [idEmpresa]
  );
  const siguiente = rows[0].total + 1;
  return `C-${String(siguiente).padStart(6, '0')}`;
}

async function crear(idEmpresa, data, idUsuarioCreador) {
  const {
    idPersona, idSede, idZona, idCampana, idTipoVenta, idModalidadCobranza,
    numeroCuotas, totalContrato, fechaVenta, fechaPrimerVencimiento,
    observaciones, detalle // [{ idPrograma, idServicio, precio }]
  } = data;

  return withTransaction(async (client) => {
    const numeroContrato = await generarNumeroContrato(client, idEmpresa);

    // 1) Registrar el contrato (RG-020/021/022/024)
    const { rows: contratoRows } = await client.query(
      `INSERT INTO contrato
         (numero_contrato, id_empresa, id_sede, id_persona, id_usuario, id_zona,
          id_campana, id_tipo_venta, id_modalidad_cobranza, id_estado_contrato,
          numero_cuotas, total_contrato, fecha_venta, fecha_primer_vencimiento,
          observaciones, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [numeroContrato, idEmpresa, idSede, idPersona, idUsuarioCreador, idZona || null,
        idCampana || null, idTipoVenta, idModalidadCobranza, ID_ESTADO_CONTRATO_REGISTRADO,
        numeroCuotas, totalContrato, fechaVenta, fechaPrimerVencimiento,
        observaciones || null, idUsuarioCreador]
    );
    const contrato = contratoRows[0];

    // 2) Detalle del contrato (RG-023: uno o varios programas/servicios)
    for (const item of detalle || []) {
      await client.query(
        `INSERT INTO detalle_contrato (id_contrato, id_programa, id_servicio, precio)
         VALUES ($1,$2,$3,$4)`,
        [contrato.id_contrato, item.idPrograma || null, item.idServicio || null, item.precio]
      );
    }

    // 3) Generar cronograma automaticamente (RG-030 / RN-007)
    const { rows: cronogramaRows } = await client.query(
      `INSERT INTO cronograma (id_contrato, id_estado_cronograma, created_by)
       VALUES ($1,$2,$3) RETURNING *`,
      [contrato.id_contrato, ID_ESTADO_CRONOGRAMA_ACTIVO, idUsuarioCreador]
    );
    const cronograma = cronogramaRows[0];

    // 4) Generar cuotas (RG-031/032/033)
    const cuotasCalculadas = generarNumeroCuotas(totalContrato, numeroCuotas, fechaPrimerVencimiento);
    for (const c of cuotasCalculadas) {
      await client.query(
        `INSERT INTO cuota (id_cronograma, numero_cuota, fecha_vencimiento, monto_programado, id_estado_cuota)
         VALUES ($1,$2,$3,$4,$5)`,
        [cronograma.id_cronograma, c.numero, c.fecha, c.monto, ID_ESTADO_CUOTA_PENDIENTE]
      );
    }

    // 5) Registrar matricula (doc 02: estado inicial del proceso operativo)
    await client.query(
      `INSERT INTO matricula (id_contrato, id_estado_proceso_matricula)
       VALUES ($1,$2)`,
      [contrato.id_contrato, ID_ESTADO_PROCESO_MATRICULA_REGISTRADA]
    );

    // 6) Libro Mayor: el contrato nace y genera la deuda completa (Regla 1 y 2, Arquitectura v1.0)
    await client.query(
      `INSERT INTO movimiento_financiero
         (id_contrato, id_tipo_movimiento_financiero, debito, credito_monto, saldo_resultante, descripcion, created_by)
       VALUES ($1,$2,$3,0,$3,'Contrato generado',$4)`,
      [contrato.id_contrato, ID_TIPO_MOVIMIENTO_CONTRATO_GENERADO, totalContrato, idUsuarioCreador]
    );

    // 7) Auditoria (RM-004)
    await registrarAuditoria(client, {
      idUsuario: idUsuarioCreador,
      tablaAfectada: 'contrato',
      idRegistroAfectado: contrato.id_contrato,
      accion: 'CREAR',
      estadoNuevo: contrato
    });

    return { contrato, cronograma, cuotas: cuotasCalculadas };
  });
}

async function obtenerConCronograma(idContrato) {
  const { rows: contratoRows } = await pool.query(
    'SELECT * FROM contrato WHERE id_contrato = $1', [idContrato]
  );
  if (contratoRows.length === 0) return null;

  const { rows: cuotas } = await pool.query(
    `SELECT cu.* FROM cuota cu
       JOIN cronograma cr ON cr.id_cronograma = cu.id_cronograma
      WHERE cr.id_contrato = $1
      ORDER BY cu.numero_cuota`,
    [idContrato]
  );

  return { contrato: contratoRows[0], cuotas };
}

async function listarPorAsesor(idUsuario, idEmpresa) {
  const { rows } = await pool.query(
    `SELECT * FROM contrato WHERE id_usuario = $1 AND id_empresa = $2
     ORDER BY fecha_venta DESC`,
    [idUsuario, idEmpresa]
  );
  return rows;
}

async function listarTodos(idEmpresa) {
  const { rows } = await pool.query(
    `SELECT c.*, p.nombres_apellidos, u.usuario AS asesor_usuario
       FROM contrato c
       JOIN persona p ON p.id_persona = c.id_persona
       JOIN usuario u ON u.id_usuario = c.id_usuario
      WHERE c.id_empresa = $1
      ORDER BY c.fecha_venta DESC`,
    [idEmpresa]
  );
  return rows;
}

module.exports = { crear, obtenerConCronograma, listarPorAsesor, listarTodos };
