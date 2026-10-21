# CI validation and process health

The `CI` workflow runs for pull requests targeting `master`, including fork PRs,
using a GitHub-hosted Ubuntu 24.04 runner. It does not deploy, contact the VPS,
change production data, or require GitHub secrets. Token permissions are limited
to reading repository contents; checkout does not persist credentials.

Node.js is pinned to `22.23.3`, the production runtime recorded in
`DEPLOYMENT_AUDIT.md`. Local validation should use that version too. The workflow
runs `npm ci` followed by the unchanged `npm test` command (Jest in band).
Official actions are pinned to commit SHAs. Update these pins and the Node
version deliberately when upgrading the supported runtime.

## Test database

The workflow starts the MySQL service already installed on the disposable
runner, creates `spi_scouting_ci`, and grants a CI-only account privileges on
that schema. Credentials in the workflow are disposable test values, not secrets
or production credentials. Application initialization creates its normal tables
in that test database. No application schema code is changed by this work.

The runner is discarded after the job. No persistent database, container,
self-hosted runner or additional production infrastructure is introduced.
MySQL on the runner is not the production MariaDB 11.4 server: a green CI run is
not a substitute for the separately required MariaDB upgrade/restore rehearsal.

Integration tests modify database rows and files under `src/public/uploads`.
Run them only in a disposable checkout with an explicitly dedicated local test
database and all five DB connection variables set. Never point tests at a live
database. For example, after provisioning your own isolated test database/user:

```bash
NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=3306 \
DB_NAME='<dedicated test schema>' DB_USER='<test user>' DB_PASSWORD='<test password>' \
SESSION_SECRET=local-test-only ADMIN_EMAIL=admin@local ADMIN_PASSWORD='' \
LOG_LEVEL=error LOG_FILE_PATH='' npm test
```

The API import tests replace fetch with fixtures; no real ProcessIQ account is
needed. The full suite requires MySQL, writable temporary/upload directories and
local sockets for Supertest. No tests are skipped or ignored in CI.

The dummy-login unit test mocks database access/initialization while preserving
its bcrypt and response assertions. The rate-limiter fixture supplies req.flash,
as Express does. App integration tests advance Date.now into a fresh limiter
window per case, preserving the actual limiter within each case. Suite teardown
clears imported maintenance intervals instead of using Jest forceExit. The club
creation assertion covers all four existing default modules, including disabled
player_load; no route/business assertions were removed.

Database-independent checks can run without MySQL:

```bash
npm test -- --runTestsByPath tests/health.test.js tests/authRoutes_dummy.test.js tests/simpleRateLimiter.test.js tests/playerLoadContext.test.js tests/playerLoadMetrics.test.js
```

## Health contract

`GET /health` returns HTTP 200 with exactly `{"status":"ok"}`, JSON content type,
and `Cache-Control: no-store`. It runs before body parsing, sessions, product/club
context and authenticated routes, without querying the database or setting a
session cookie. Normal request logging still applies. No configuration, version,
credentials, user data or dependency errors appear in the response.

This endpoint reports process HTTP liveness, not database readiness. Production
startup still waits for its existing database initialization before listening;
subsequent database failure does not change this liveness response. No listener,
startup, database or existing route behavior is changed. The production-local
HOST binding change and all deployment blockers in the audit remain separate.

Once this code is separately deployed, monitors can probe `/health` with a short
timeout and require both 200 and the expected body. It is not installed on the
VPS by this change. Monitoring/alerting infrastructure is not configured here.

## References

- [GitHub Ubuntu runner inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md) documents the installed MySQL service and start command.
- [setup-node documentation](https://github.com/actions/setup-node) describes version selection and lockfile-based npm caching.

GitHub execution itself must be verified on the next PR; this implementation
does not push changes or change repository branch-protection settings.

## Local validation result

`npm ci --no-audit --no-fund` completed using the existing lockfile. All seven
suites / 190 tests passed against a newly created, dedicated local schema on
MySQL 9.6.0, both with Node 26.3.0 and then with the CI/production Node 22.23.3
runtime (190/190 tests on each run). Syntax checks, YAML parsing and git diff
whitespace checks passed. The local database engine differs from CI and
production; GitHub runner execution and the production MariaDB rehearsal remain
separate checks. The local test schema was retained for inspection. Dependency
installation reported existing deprecations (including multer and supertest);
no dependency upgrade or npm audit fix was performed.

## Separation from player_load

CI/healthcheck changes are now on ci-healthcheck, based on local master
8de76aa28f47b66658c785dccb5d93718c142562. The player_load improvement commit
5b3e55a remains on its original branch and is not included. A full rerun on this
master-based branch passed all seven suites / 182 tests with Node 22.23.3 and
the dedicated local MySQL test schema. The earlier 190-test results above were
collected before separation; the eight additional cases belong to player_load.
No tests were removed from master to obtain this result.

## Remote base verification before PR

GitHub master was subsequently verified at 24b2499 (PR #17 already merged
player_load). The isolated CI commit was rebased onto that remote master, so
this PR does not introduce or revert the player_load changes. The 182-test run
describes the earlier local-master baseline; the current base includes the
eight player_load cases, previously validated as part of the 190-test run.

## GitHub runner timezone

The first PR #18 run passed 189/190 tests. The last-login display fixture stores
a timezone-less DATETIME and expects its wall-clock value in the Madrid view.
The runner default UTC interpreted that fixture differently from local execution.
CI explicitly sets TZ=Europe/Madrid for deterministic parsing aligned with the
existing view timezone; the assertion and application code remain unchanged.

The runner MySQL global time_zone is also set to the current Madrid UTC offset
before opening application connections. This aligns CURRENT_TIMESTAMP with
Node/mysql2 interpretation of timezone-less DATETIME values for the short test
run. It affects only the disposable CI server, never production.

## Reuse for master delivery

CI also exposes workflow_call. deploy-production.yml reuses the identical test
job on pushes to master before its separately gated production job. PR validation
continues without production secrets. See AUTOMATED_DEPLOYMENT.md for the disabled
bootstrap gate, SSH restrictions, backup behavior and remaining server checks.
Deployment helper tests use mocked operations and never contact the production VPS.
