const service = require('./cronogramas.service');
const asyncHandler = require('../../utils/asyncHandler');

const reprogramar = asyncHandler(async (req, res) => {
  const resultado = await service.reprogramar(req.params.idContrato, req.body, req.user.idUsuario);
  res.status(201).json(resultado);
});

const historial = asyncHandler(async (req, res) => {
  const cronogramas = await service.historial(req.params.idContrato);
  res.json(cronogramas);
});

module.exports = { reprogramar, historial };
