const service = require('./dashboard.service');
const asyncHandler = require('../../utils/asyncHandler');

const asesor = asyncHandler(async (req, res) => {
  const data = await service.asesorDashboard(req.user.idUsuario, req.user.idEmpresa);
  res.json(data);
});

const cobranzas = asyncHandler(async (req, res) => {
  const data = await service.cobranzasDashboard(req.user.idEmpresa);
  res.json(data);
});

const ceo = asyncHandler(async (req, res) => {
  const data = await service.ceoDashboard(req.user.idEmpresa);
  res.json(data);
});

module.exports = { asesor, cobranzas, ceo };
