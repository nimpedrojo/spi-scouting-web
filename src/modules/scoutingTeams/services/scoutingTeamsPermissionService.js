function getScoutingTeamsPermissions(user, report = null) {
  const role = user ? user.role : null;
  const isAuthenticated = Boolean(user);
  const isAdmin = role === 'admin' || role === 'superadmin';
  const isAuthor = Boolean(
    user
      && report
      && report.createdBy !== null
      && report.createdBy !== undefined
      && Number(report.createdBy) === Number(user.id),
  );

  return {
    canList: isAuthenticated,
    canView: isAuthenticated,
    canCreate: isAuthenticated,
    canEdit: isAdmin || isAuthor,
    canDelete: isAdmin,
    canManageAll: isAdmin,
    isAuthor,
  };
}

module.exports = {
  getScoutingTeamsPermissions,
};
