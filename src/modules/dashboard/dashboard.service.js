const { pool } = require('../../config/db');

// IDs fijos segun el orden de insercion en sigec_seed.sql
const ID_ESTADO_CUOTA_PENDIENTE = 1;
const ID_ESTADO_CUOTA_PARCIAL = 2;
const ID_ESTADO_CUOTA_ANULADA = 5;
const ID_ESTADO_REEMBOLSO_SOLICITADO = 1;
const ID_ESTADO_REMESA_GENERADA = 2;
const ID_ESTADO_REMESA_ENVIADA = 3;

function periodoActual() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Dashboard del Asesor Comercial (doc 04): enfoque motivacional,
 * solo indicadores del propio asesor (PD-003).
 */
async function asesorDashboard(idUsuario, idEmpresa) {
  const periodo = periodoActual();

  const { rows: contratosMes } = await pool.query(
    `SELECT count(*)::int AS total, COALESCE(sum(total_contrato),0) AS monto
       FROM contrato
      WHERE id_usuario = $1 AND id_empresa = $2
        AND to_char(fecha_venta, 'YYYY-MM') = $3`,
    [idUsuario, idEmpresa, periodo]
  );

  const { rows: metaRows } = await pool.query(
    'SELECT meta_contratos, meta_monto FROM meta_comercial WHERE id_usuario = $1 AND periodo = $2',
    [idUsuario, periodo]
  );
  const meta = metaRows[0] || null;
  const contratosRegistrados = contratosMes[0].total;
  const contratosFaltantes = meta && meta.meta_contratos != null
    ? Math.max(meta.meta_contratos - contratosRegistrados, 0)
    : null;

  const { rows: porcentajeRows } = await pool.query(
    "SELECT valor FROM configuracion_empresa WHERE id_empresa = $1 AND clave = 'PORCENTAJE_COMISION_ASESOR'",
    [idEmpresa]
  );
  const porcentajeComision = Number(porcentajeRows[0]?.valor || 0);
  const comisionEstimada = Math.round(Number(contratosMes[0].monto) * (porcentajeComision / 100) * 100) / 100;

  // Profesores que realizaron su PRIMER pago (en cualquiera de sus
  // contratos con este asesor) durante el mes en curso.
  const { rows: primerPagoRows } = await pool.query(
    `SELECT count(*)::int AS total FROM (
        SELECT p.id_persona, MIN(pg.fecha_pago) AS primer_pago
          FROM persona p
          JOIN contrato c ON c.id_persona = p.id_persona
          JOIN pago pg ON pg.id_contrato = c.id_contrato
         WHERE c.id_usuario = $1
         GROUP BY p.id_persona
     ) t WHERE to_char(primer_pago, 'YYYY-MM') = $2`,
    [idUsuario, periodo]
  );

  const { rows: ventasPorPrograma } = await pool.query(
    `SELECT COALESCE(pr.nombre, sv.nombre, 'Sin categoria') AS nombre, sum(dc.precio) AS monto
       FROM detalle_contrato dc
       JOIN contrato c ON c.id_contrato = dc.id_contrato
       LEFT JOIN programa pr ON pr.id_programa = dc.id_programa
       LEFT JOIN servicio sv ON sv.id_servicio = dc.id_servicio
      WHERE c.id_usuario = $1 AND to_char(c.fecha_venta, 'YYYY-MM') = $2
      GROUP BY COALESCE(pr.nombre, sv.nombre, 'Sin categoria')
      ORDER BY monto DESC`,
    [idUsuario, periodo]
  );

  const { rows: ventasPorZona } = await pool.query(
    `SELECT COALESCE(z.nombre, 'Sin zona') AS nombre, sum(c.total_contrato) AS monto
       FROM contrato c
       LEFT JOIN zona z ON z.id_zona = c.id_zona
      WHERE c.id_usuario = $1 AND to_char(c.fecha_venta, 'YYYY-MM') = $2
      GROUP BY COALESCE(z.nombre, 'Sin zona')
      ORDER BY monto DESC`,
    [idUsuario, periodo]
  );

  const { rows: ultimosContratos } = await pool.query(
    `SELECT c.id_contrato, c.numero_contrato, c.total_contrato, c.fecha_venta, p.nombres_apellidos
       FROM contrato c JOIN persona p ON p.id_persona = c.id_persona
      WHERE c.id_usuario = $1
      ORDER BY c.fecha_venta DESC, c.id_contrato DESC
      LIMIT 5`,
    [idUsuario]
  );

  return {
    periodo,
    contratosRegistrados,
    metaMensual: meta?.meta_contratos ?? null,
    contratosFaltantes,
    comisionEstimada,
    profesoresPrimerPagoEsteMes: primerPagoRows[0].total,
    ventasPorPrograma,
    ventasPorZona,
    ultimosContratos
  };
}

/**
 * Dashboard de Cobranzas (doc 04): indicadores operativos y de
 * seguimiento del dia a dia del area.
 */
async function cobranzasDashboard(idEmpresa) {
  const { rows: pagosHoy } = await pool.query(
    `SELECT count(*)::int AS total, COALESCE(sum(pg.monto),0) AS monto
       FROM pago pg JOIN contrato c ON c.id_contrato = pg.id_contrato
      WHERE c.id_empresa = $1 AND pg.fecha_pago::date = CURRENT_DATE`,
    [idEmpresa]
  );

  const { rows: cuotasVencidas } = await pool.query(
    `SELECT count(*)::int AS total,
            COALESCE(sum(cu.monto_programado - COALESCE(ap.aplicado,0)),0) AS monto
       FROM cuota cu
       JOIN cronograma cr ON cr.id_cronograma = cu.id_cronograma
       JOIN contrato c ON c.id_contrato = cr.id_contrato
       LEFT JOIN (
            SELECT id_cuota, sum(monto_aplicado) AS aplicado
              FROM aplicacion_pago GROUP BY id_cuota
       ) ap ON ap.id_cuota = cu.id_cuota
      WHERE c.id_empresa = $1
        AND cu.id_estado_cuota IN ($2, $3)
        AND cu.fecha_vencimiento < CURRENT_DATE`,
    [idEmpresa, ID_ESTADO_CUOTA_PENDIENTE, ID_ESTADO_CUOTA_PARCIAL]
  );

  const { rows: reembolsosPendientes } = await pool.query(
    `SELECT count(*)::int AS total FROM reembolso r
       JOIN credito cr ON cr.id_credito = r.id_credito
       JOIN persona p ON p.id_persona = cr.id_persona
      WHERE p.id_empresa = $1 AND r.id_estado_reembolso = $2`,
    [idEmpresa, ID_ESTADO_REEMBOLSO_SOLICITADO]
  );

  const { rows: remesasPendientes } = await pool.query(
    `SELECT count(*)::int AS total FROM remesa_planilla
      WHERE id_empresa = $1 AND id_estado_remesa IN ($2, $3)`,
    [idEmpresa, ID_ESTADO_REMESA_GENERADA, ID_ESTADO_REMESA_ENVIADA]
  );

  const { rows: aulasPendientes } = await pool.query(
    `SELECT count(*)::int AS total FROM matricula m
       JOIN contrato c ON c.id_contrato = m.id_contrato
      WHERE c.id_empresa = $1 AND m.aula_virtual_habilitada = FALSE`,
    [idEmpresa]
  );

  return {
    pagosRegistradosHoy: pagosHoy[0].total,
    montoCobradoHoy: Number(pagosHoy[0].monto),
    cuotasVencidas: cuotasVencidas[0].total,
    montoVencido: Number(cuotasVencidas[0].monto),
    reembolsosPendientes: reembolsosPendientes[0].total,
    remesasPendientes: remesasPendientes[0].total,
    aulasVirtualesPendientes: aulasPendientes[0].total
  };
}

/**
 * Dashboard del CEO (doc 04): solo lectura, indicadores estrategicos.
 * RN-013: el CEO no ejecuta operaciones, solo consulta.
 */
async function ceoDashboard(idEmpresa) {
  const periodo = periodoActual();

  const { rows: ventasMes } = await pool.query(
    `SELECT count(*)::int AS contratos, COALESCE(sum(total_contrato),0) AS monto
       FROM contrato WHERE id_empresa = $1 AND to_char(fecha_venta,'YYYY-MM') = $2`,
    [idEmpresa, periodo]
  );

  const { rows: cobranzaMes } = await pool.query(
    `SELECT COALESCE(sum(pg.monto),0) AS monto
       FROM pago pg JOIN contrato c ON c.id_contrato = pg.id_contrato
      WHERE c.id_empresa = $1 AND to_char(pg.fecha_pago,'YYYY-MM') = $2`,
    [idEmpresa, periodo]
  );

  const { rows: carteraRows } = await pool.query(
    `SELECT
        COALESCE(sum(cu.monto_programado),0) AS cartera_total,
        COALESCE(sum(CASE WHEN cu.fecha_vencimiento < CURRENT_DATE
                           THEN cu.monto_programado - COALESCE(ap.aplicado,0) ELSE 0 END),0) AS monto_vencido
       FROM cuota cu
       JOIN cronograma cr ON cr.id_cronograma = cu.id_cronograma
       JOIN contrato c ON c.id_contrato = cr.id_contrato
       LEFT JOIN (
            SELECT id_cuota, sum(monto_aplicado) AS aplicado
              FROM aplicacion_pago GROUP BY id_cuota
       ) ap ON ap.id_cuota = cu.id_cuota
      WHERE c.id_empresa = $1 AND cu.id_estado_cuota != $2`,
    [idEmpresa, ID_ESTADO_CUOTA_ANULADA]
  );
  const carteraTotal = Number(carteraRows[0].cartera_total);
  const montoVencido = Number(carteraRows[0].monto_vencido);
  const morosidadPorcentaje = carteraTotal > 0 ? Math.round((montoVencido / carteraTotal) * 10000) / 100 : 0;

  const { rows: comparativoMensual } = await pool.query(
    `SELECT to_char(fecha_venta, 'YYYY-MM') AS mes, count(*)::int AS contratos, sum(total_contrato) AS monto
       FROM contrato
      WHERE id_empresa = $1 AND fecha_venta >= (CURRENT_DATE - INTERVAL '6 months')
      GROUP BY to_char(fecha_venta, 'YYYY-MM')
      ORDER BY mes`,
    [idEmpresa]
  );

  const { rows: programasMasVendidos } = await pool.query(
    `SELECT COALESCE(pr.nombre, sv.nombre, 'Sin categoria') AS nombre, sum(dc.precio) AS monto, count(*)::int AS ventas
       FROM detalle_contrato dc
       JOIN contrato c ON c.id_contrato = dc.id_contrato
       LEFT JOIN programa pr ON pr.id_programa = dc.id_programa
       LEFT JOIN servicio sv ON sv.id_servicio = dc.id_servicio
      WHERE c.id_empresa = $1
      GROUP BY COALESCE(pr.nombre, sv.nombre, 'Sin categoria')
      ORDER BY monto DESC LIMIT 10`,
    [idEmpresa]
  );

  const { rows: rendimientoPorAsesor } = await pool.query(
    `SELECT u.usuario, p.nombres_apellidos, count(c.id_contrato)::int AS contratos, COALESCE(sum(c.total_contrato),0) AS monto
       FROM usuario u
       JOIN persona p ON p.id_persona = u.id_persona
       LEFT JOIN contrato c ON c.id_usuario = u.id_usuario AND to_char(c.fecha_venta,'YYYY-MM') = $2
      WHERE u.id_empresa = $1
      GROUP BY u.id_usuario, u.usuario, p.nombres_apellidos
      HAVING count(c.id_contrato) > 0
      ORDER BY monto DESC`,
    [idEmpresa, periodo]
  );

  const { rows: ventasPorZona } = await pool.query(
    `SELECT COALESCE(z.nombre, 'Sin zona') AS nombre, sum(c.total_contrato) AS monto
       FROM contrato c LEFT JOIN zona z ON z.id_zona = c.id_zona
      WHERE c.id_empresa = $1 AND to_char(c.fecha_venta,'YYYY-MM') = $2
      GROUP BY COALESCE(z.nombre, 'Sin zona')
      ORDER BY monto DESC`,
    [idEmpresa, periodo]
  );

  return {
    periodo,
    ventasMes: { contratos: ventasMes[0].contratos, monto: Number(ventasMes[0].monto) },
    cobranzaMes: Number(cobranzaMes[0].monto),
    morosidad: { carteraTotal, montoVencido, porcentaje: morosidadPorcentaje },
    comparativoMensual,
    programasMasVendidos,
    rendimientoPorAsesor,
    ventasPorZona
    // Nota: "rentabilidad" (doc 04) requiere datos de costos que aun no
    // existen en el modelo (ej. costo por programa/docente). Queda
    // pendiente hasta que se defina esa entidad.
  };
}

module.exports = { asesorDashboard, cobranzasDashboard, ceoDashboard };
