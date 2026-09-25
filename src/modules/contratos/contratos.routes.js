const { Router } = require('express');
const controller = require('./contratos.controller');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');

const router = Router();

router.use(authenticate);

router.post('/', authorize('CONTRATO_CREAR'), controller.crear);
router.get('/mios', authorize('CONTRATO_VER_PROPIO'), controller.misContratos);
router.get('/', authorize('CONTRATO_VER_TODOS'), controller.listarTodos);
router.get('/:id', authorize(['CONTRATO_VER_TODOS', 'CONTRATO_VER_PROPIO']), controller.obtener);
// Nota: RN-011 (el asesor solo ve/edita sus propios contratos hasta que
// Cobranzas los procese) se resuelve hoy con permisos distintos para
// "propio" vs "todos". Falta el filtro fino por titularidad dentro de
// obtener/editar cuando el rol solo tiene CONTRATO_VER_PROPIO.

module.exports = router;
