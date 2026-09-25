const { Router } = require('express');
const controller = require('./personas.controller');
const { authenticate, authorize } = require('../../middlewares/auth.middleware');

const router = Router();

router.use(authenticate);

router.post('/', authorize('PERSONA_CREAR'), controller.crear);
router.get('/', authorize('PERSONA_VER'), controller.listar);
router.get('/:id', authorize('PERSONA_VER'), controller.obtener);

module.exports = router;
