function requireRole(...roles) {
  return (req, res, next) => {
    const currentUser = req.session ? req.session.user : null;

    if (!currentUser) {
      req.flash('error', 'Debes iniciar sesión.');
      return res.redirect('/login');
    }

    if (!roles.includes(currentUser.role)) {
      req.flash('error', 'No tienes permisos para acceder a esta sección.');
      return res.redirect('/');
    }

    return next();
  };
}

module.exports = {
  requireRole,
};
