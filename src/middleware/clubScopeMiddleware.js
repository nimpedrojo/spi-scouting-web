function getRequestClub(req) {
  if (req.context && req.context.club) {
    return req.context.club;
  }

  if (req.session && req.session.clubContext) {
    return {
      id: req.session.clubContext.clubId,
      name: req.session.clubContext.clubName,
    };
  }

  return null;
}

function requireClubScope(req, res, next) {
  const club = getRequestClub(req);

  if (!club || !club.id) {
    req.flash('error', 'Necesitas un club activo para acceder a esta sección.');
    return res.redirect('/account');
  }

  return next();
}

module.exports = {
  getRequestClub,
  requireClubScope,
};
