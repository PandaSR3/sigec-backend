/**
 * Reparte un monto entre N cuotas mensuales a partir de una fecha,
 * ajustando la ultima cuota para que la suma cuadre exacto (evita
 * errores de redondeo). Usado tanto al crear un contrato como al
 * reprogramar un cronograma (RG-030).
 */
function generarCuotas(monto, numeroCuotas, fechaPrimerVencimiento) {
  const montoBase = Math.floor((monto / numeroCuotas) * 100) / 100;
  const cuotas = [];
  let acumulado = 0;

  for (let i = 1; i <= numeroCuotas; i++) {
    const esUltima = i === numeroCuotas;
    const cuotaMonto = esUltima ? Math.round((monto - acumulado) * 100) / 100 : montoBase;
    acumulado += cuotaMonto;

    const fecha = new Date(fechaPrimerVencimiento);
    fecha.setMonth(fecha.getMonth() + (i - 1));

    cuotas.push({ numero: i, monto: cuotaMonto, fecha: fecha.toISOString().slice(0, 10) });
  }
  return cuotas;
}

module.exports = { generarCuotas };
