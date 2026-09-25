// Evita repetir try/catch en cada controller: si la promesa rechaza,
// el error cae directo al middleware de errores.
module.exports = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
