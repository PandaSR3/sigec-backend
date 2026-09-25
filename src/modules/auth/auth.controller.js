const authService = require('./auth.service');
const asyncHandler = require('../../utils/asyncHandler');

const login = asyncHandler(async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) {
    return res.status(400).json({ error: 'usuario y password son requeridos' });
  }
  const ip = req.ip;
  const result = await authService.login(usuario, password, ip);
  res.json(result);
});

module.exports = { login };
