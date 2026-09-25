const jwt = require('jsonwebtoken');

/**
 * Verifica el JWT y adjunta el usuario autenticado a req.user.
 * El payload del token ya trae los permisos resueltos al momento del
 * login (ver auth.service.js), para no golpear la base de datos en
 * cada request.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { idUsuario, idPersona, usuario, roles: [...], permisos: [...] }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido o expirado' });
  }
}

/**
 * RG-091: los permisos dependen del perfil asignado.
 * Uso: router.post('/', authenticate, authorize('CONTRATO_CREAR'), controller)
 * Tambien acepta un array para "cualquiera de estos permisos":
 * authorize(['CONTRATO_VER_TODOS', 'CONTRATO_VER_PROPIO'])
 */
function authorize(permisoCodigo) {
  const requeridos = Array.isArray(permisoCodigo) ? permisoCodigo : [permisoCodigo];
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    const autorizado = requeridos.some((p) => req.user.permisos.includes(p));
    if (!autorizado) {
      return res.status(403).json({ error: `No tiene el permiso requerido: ${requeridos.join(' o ')}` });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
