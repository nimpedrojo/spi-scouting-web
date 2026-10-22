# Production deployment audit

Date: 2026-10-21. Repository inspected: `spi-scouting-web`, commit `5b3e55a5c9fab017165c1a5d406182ebb1fc4c4d`. Production branch: `master` (provided by owner).

## Decision and scope

Recommend GitHub Actions validation followed by SSH delivery of an exact commit to a new VPS release directory, shared persistent state, an atomic active-release symlink switch, and a restart of only this application's existing PM2 process. Keep Nginx/HestiaCP and MySQL. Start with one fork-mode instance and accept a brief restart interruption; this code does not support a credible zero-downtime promise.

**Implementation is blocked pending production inventory, persistence reconciliation, database rehearsal/backup verification, and an agreed restart/session policy.** No VPS was accessed, no deployment or secret creation occurred, and no application behavior was changed. Production facts supplied in the four owner-provided inventory transcripts are recorded below; they were not independently collected through a VPS connection. Paths, ports and process names in older documentation are examples, not discovered production facts.

## Confirmed current architecture

| Area | Repository evidence and consequence |
| --- | --- |
| Runtime | CommonJS Node.js, Express 5.2.1, EJS, Bootstrap and MySQL through `mysql2/promise`. MVC plus `src/core`, `src/shared`, and modules for planning, scouting teams, scouting players and player load. |
| Startup | `package.json` main is `src/server.js`; `npm start` runs `node src/server.js`; development uses nodemon. No compile/build step. Views, public assets and `src/templates/report_template.xlsm` must ship with source. |
| Listener | `src/server.js` uses `PORT`, falling back to 3000; no explicit bind address, so it is not constrained to loopback by the code. The supplied inventory maps the target PID to `127.0.0.1:3002`; public routing/firewall policy remains unverified. This loopback listener differs from the repository listener without an explicit host, so inspect deployed source before assuming parity. |
| Dependencies | Only `package-lock.json`, lockfile version 3. Use `npm ci`, not lockfile regeneration. No `engines`, `packageManager`, `.nvmrc`, `.node-version` or versioned `.npmrc` found. Locked Express requires Node >=18, and imports use global `fetch`; that lower bound is not a recommendation to deploy an obsolete runtime. Select a supported LTS and pin an exact tested Node/npm combination after inventory. |
| Process manager | Owner reports PM2 on a private Linux VPS shared with other ProcessIQ apps; no ecosystem file exists in the repository. PM2 is not a package dependency. |
| HTTP/proxy | `src/app.js` sets `trust proxy` to one hop and enables secure session cookies only when `NODE_ENV=production`. Verify the real Hestia/Nginx proxy chain, forwarded headers, HTTPS and direct backend accessibility. |
| Sessions | `express-session` has no configured store: default MemoryStore, eight-hour cookies, default cookie name. Restart loses sessions and session-held import previews. Multiple workers do not share sessions or rate limits (`src/middleware/simpleRateLimiter.js`). Shared-hostname applications may also have cookie-name/path collisions. |
| Tests | Jest 29 + Supertest; `npm test` is `jest --runInBand`; six test files, configured under `tests/`. Routes, authentication, uploads, evaluations and module flows have integration coverage; metrics/context/rate-limiter tests also exist. There is no recorded clean CI baseline in this audit. |
| Test side effects | `tests/app.test.js` and `tests/playerLoad.test.js` import the app, initialize schema, insert/delete database rows; app tests snapshot/clean upload directories. The dummy-auth test also imports the app. No enforced dedicated test DB guard was found. Never run the full suite against production configuration or in a live release. |
| Health | No dedicated liveness/readiness endpoint found. `/` redirects to `/login` or `/dashboard`; `/login` is a possible HTTP smoke check, not a comprehensive database/readiness check. Static responses or PM2 `online` are insufficient evidence. |

### Environment and filesystem dependencies

`dotenv.config()` reads `.env` relative to process CWD; inherited environment takes precedence by default. `logger.js` and `secretStore.js` capture settings at module load, before the explicit dotenv call in `app.js`. In the inspected entry path, the imported DB module loads dotenv first. Preserve a deliberate startup environment and CWD rather than depending on incidental import order. Old PM2 environment values may override a newly linked `.env`.

| Variables | Current behavior / deployment requirement |
| --- | --- |
| `NODE_ENV`, `PORT` | Set production mode and the inventoried dedicated application port. Neither appears in `.env.example`. |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Connection settings; code defaults include localhost, 3306, root, empty password and `soccer_report`. `.env.example` uses a different example database name. Supply explicit real settings; never accept defaults silently. |
| `SESSION_SECRET` | Falls back to `session_secret_dev`; require a strong existing production value, kept stable between releases. Rotation invalidates cookies and should be planned separately. |
| `APP_SECRET_KEY`, fallback `PROCESSIQ_SECRET_KEY` | AES-GCM key for stored ProcessIQ credentials; absent key makes encryption/decryption a no-op. Preserve the exact existing key and backup it securely; blindly adding/rotating a key can make historical credentials unreadable. Neither is documented in `.env.example`. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Startup bootstrap settings. Default email is `admin@local`; missing password or literal `admin` skips creation; any other nonempty password can create a superadmin if email is absent. Inventory intended bootstrap behavior without disclosing values. |
| `LOG_LEVEL`, `LOG_FILE_PATH`, `APP_NAME` | JSON stdout/stderr and optional file. Relative file paths resolve against CWD; directory creation happens on import. An inaccessible log directory can prevent startup. Use an inventoried shared absolute file path or deliberate PM2 log capture, with rotation. |
| `REPORT_TEMPLATE_PATH` | Optional spreadsheet template override; otherwise shipped `src/templates/report_template.xlsm`. Preserve any production customization and read permissions. |
| `PROCESSIQ_API_URL` | Optional upstream override; default in code is `https://api.processiq.es`. Imports depend on outbound HTTPS/DNS and credentials stored in MySQL. |

Persistent writes **do exist inside the project**:

- `src/public/uploads/players`: player photos; created on module import, uploaded/replaced/deleted by `src/routes/playerAdminRoutes.js`.
- `src/public/uploads/clubs`: club crests, created/written by `src/routes/clubConfigRoutes.js`.
- `src/public/uploads/planning`: planning images, including copied template images; see planning routes and `planningTaskAssetService.js`.
- Optional logs, such as `.env.example`'s `./logs/app.log`.

Imports in player/evaluation handlers use `os.tmpdir()` and attempt cleanup; failed requests/process termination may leave temporary files. Confirm available space and the actual runtime temp directory. MySQL is the primary persistence layer. PM2 state/logs are outside application source but their actual locations depend on its owner and `PM2_HOME`.

There are **20 tracked JPG uploads** (19 player photos and one club crest), plus `.gitkeep` files. Uploads are not excluded by `.gitignore`. Future release artifacts must exclude runtime uploads and must never overwrite shared uploads with repository copies. Before the first switch, reconcile live files with tracked files and database paths; do not discard either blindly. Upload URLs are served through public static middleware; preserve existing URL structure, while separately reviewing access/privacy requirements.

### Database initialization and changes

`src/app.js` invokes `initDatabaseOnce()` on import, and `src/server.js` waits for that same cached promise before listening. This is once per Node process, not a cross-process migration lock.

`src/db.js` issues `CREATE DATABASE IF NOT EXISTS`, and `src/initDb.js` sequentially creates tables, invokes model-level ALTER operations, seeds sections/categories/modules/platform settings, synchronizes user club assignments, and may bootstrap a superadmin. A one-off SQL file exists at `sql/2026-04-20_create_season_team_recommendations.sql`, but there is no versioned migration runner, schema-version ledger, dedicated migration npm script, or automatic down migration.

Several ALTER catches, including `userModel.js`, log unexpected errors and continue. Successful startup therefore does not prove all expected schema changes succeeded. MySQL DDL and data backfills are not an atomic release transaction; partial changes/metadata locks can occur. The runtime needs permissions for its actual CREATE/ALTER/index/foreign-key and data operations; do not grant global/root access as a shortcut. Validate the existing grants against startup on a disposable clone.

Startup failure is logged without an explicit nonzero exit or guaranteed pool shutdown. There are no signal handlers, HTTP draining, pool-close shutdown, or PM2 readiness messages. A failed initialization may leave a process alive without an HTTP listener. Check HTTP with a bounded timeout and inspect initialization errors/schema assertions; do not trust the PM2 status alone.

## Existing deployment mechanism

- `docs/deploy-production.md` documents a manual release/shared/current approach, backups, staging rehearsal, dependency installation and rollback. It prioritizes systemd with PM2 as an alternative; the owner now explicitly requires existing PM2.
- Its example root, service/process names, users, ports and historical production commits are unverified. The guide's initialization command **writes to MySQL**; it is not a read-only healthcheck. It also omits concrete shared-upload linkage, atomic symlink replacement, and proof that PM2 resolves the new release.
- `docs/logging-and-observability.md` describes JSON logs and example paths. `security-audit-report.md` records historical concerns about sessions, secrets and dependencies; it is not a current dependency scan or evidence of production remediation.
- No deployment scripts, PM2 ecosystem, or GitHub Actions workflows found. `.github` contains only Copilot instructions. `scripts/aif-finish` is a developer helper, not established production delivery. `cleanup:test-data` deletes data and must never be a deployment step. `import:players` references a missing `scripts/import_players_from_excel.js`.
- Existing infrastructure automation, GitHub branch protections/environments/secrets and any VPS-side scripts were not accessible through repository inspection.

## Risks and blockers

| Priority | Risk | Required resolution |
| --- | --- | --- |
| Blocker (partially resolved) | Target name, CWD, script, interpreter and loopback port identified; daemon ownership/home, reboot setup and future release root remain unverified | Complete focused inventory below; preserve isolation from other apps. |
| Blocker | Release replacement can lose uploads or strand database file references | Inventory, backup, reconcile and move/link shared uploads in a planned first cutover. |
| Blocker | Startup changes production schema/data, sometimes swallowing errors | Rehearse the exact production-to-candidate upgrade on an isolated clone; inspect errors and resulting schema. Verify consistent DB + upload backups and a restore rehearsal before enabling automation. |
| Blocker | SSH access/network route from Actions and host identity unknown | Confirm reachable route and least-privilege account, independently verified SSH host key, and approved access policy. |
| Decision required | MemoryStore loses logins/previews; no request draining | Accept brief downtime and session loss explicitly, or implement/test a MySQL-backed session store and graceful shutdown in a separate change before rollout. Do not enable cluster mode. |
| High | PM2 may retain a resolved old release path/environment despite a `current` switch | Declare explicit CWD/script/interpreter and target only the confirmed process. Test activation and rollback path resolution; verify PID CWD and reported release SHA after restart. |
| High | Shared VPS blast radius, Hestia-managed ownership/config, accidental PM2 daemon mismatch | No root deployment, recursive permission rewrites, `pm2 restart all`, daemon kill, or unscoped process operations. Operate as the correct PM2 owner/home; confirm isolation or a restricted per-app helper if owner manages other apps. |
| High | Weak/default or historically exposed credentials; encryption key continuity | Review historical security report with owner, verify rotation status privately, preserve keys/data compatibility. Never print `.env`, full PM2 environment or dump files into CI logs. |
| High | Blind DB rollback destroys writes made after release | Code rollback only when schema/data remain compatible. Otherwise maintenance and a reviewed recovery procedure; automatic DB restoration is prohibited. |
| High | Tests can modify a real database/filesystem | CI must use isolated ephemeral MySQL credentials and workspace-only upload paths; no production secrets in validation jobs. |
| Medium | Old dependencies, runtime drift, package installation scripts | Pin/test runtime and lockfile; perform a fresh dependency review before automation. Historical `xlsx` finding is not revalidated here. Do not run `npm audit fix` during deployment. |
| Medium | Disk/inode exhaustion, temp files, logs/backups/releases accumulation | Define rotation, backup retention and safe release cleanup; never prune active/previous releases or shared files. |

## Unknown production configuration and read-only collection

Run these manually on the VPS through the existing administrative access. They are inventory commands, **not a deployment script**. Substitute placeholders only with observed values. Do not paste raw secrets, personal data, full configs or private keys into chat. No application import, startup, `npm test`, schema initialization, dump restore, service reload or filesystem write is needed for inventory.

### Host and process discovery

```bash
id
cat /etc/os-release
uname -m
df -h
df -i
free -h
ps -eo user,pid,ppid,comm | rg 'PM2|node|nginx|mysql|mariadb'
ss -ltnp
command -v node npm pm2 nginx mysql mysqldump
node --version
npm --version
systemctl list-units --type=service --all --no-pager | rg -i 'pm2|nginx|mysql|mariadb|hestia'
```

`node` in the login shell may differ from the runtime interpreter. PM2 commands can start a daemon if none is running: **only run the following after confirming the existing daemon's owner and PM2 home**, in that owner's existing session with its verified `PM2_HOME`. Do not run PM2 as root merely to obtain output.

```bash
pm2 jlist | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>console.log(JSON.stringify(JSON.parse(s).map(p=>({id:p.pm_id,name:p.name,pid:p.pid,cwd:p.pm2_env.pm_cwd,script:p.pm2_env.pm_exec_path,interpreter:p.pm2_env.exec_interpreter,mode:p.pm2_env.exec_mode,instances:p.pm2_env.instances,status:p.pm2_env.status,nodeVersion:p.pm2_env.node_version,outLog:p.pm2_env.pm_out_log_path,errorLog:p.pm2_env.pm_err_log_path,watch:p.pm2_env.watch})),null,2)))'
```

After choosing the target, collect only the deployment-relevant environment keys (redacted) and its nonsecret port/mode:

```bash
export TARGET_PM2_ID='<observed numeric ID>'
pm2 jlist | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{const p=JSON.parse(s).find(p=>String(p.pm_id)===process.env.TARGET_PM2_ID);if(!p)throw Error("Target missing");const e=p.pm2_env;console.log({PORT:e.PORT,NODE_ENV:e.NODE_ENV,configuredKeys:Object.keys(e).filter(k=>/^(DB_|ADMIN_|SESSION_|APP_SECRET_KEY$|PROCESSIQ_|REPORT_TEMPLATE_PATH$|LOG_|APP_NAME$)/.test(k))})})'
export APP_PID='<observed target PID>'
readlink -f "/proc/$APP_PID/cwd"
readlink -f "/proc/$APP_PID/exe"
```

If OS access restrictions hide process details, an administrator should run those specific reads. Inspect the identified PM2 boot unit locally with `systemctl cat '<observed PM2 unit>'`; report owner, PATH, PM2 home and restart persistence without exposing embedded environment secrets.

### Target files, permissions and configuration

```bash
export APP_DIR='<observed application directory>'
export ENV_FILE='<observed env file, if present>'
export PM2_HOME_DIR='<observed PM2 home>'
readlink -f "$APP_DIR"
stat -c '%U:%G %a %n' "$APP_DIR" "$ENV_FILE" "$PM2_HOME_DIR"
namei -l "$APP_DIR/src/public/uploads"
find "$APP_DIR/src/public/uploads" -maxdepth 2 -type d -printf '%u:%g %m %p\n'
du -sh "$APP_DIR/src/public/uploads"
find "$APP_DIR/src/public/uploads" -type f | wc -l
awk -F= '/^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=/{print $1 "=<redacted>"}' "$ENV_FILE"
git -C "$APP_DIR" rev-parse HEAD
git -C "$APP_DIR" status --short
git -C "$APP_DIR" ls-files 'src/public/uploads/*'
cat "$APP_DIR/package.json"
sha256sum "$APP_DIR/package-lock.json"
```

Git commands apply only if a checkout exists. If deployed as copied files, obtain release identity from the current operator; do not assume local HEAD equals production. Inventory custom report templates, symlink targets, log and backup locations/permissions similarly. Verify writable upload/log/temp locations as the actual app identity; avoid `touch` during this read-only phase. Existing unreadable directories remain unknown until inspected by their owner.

An administrator can inspect `sudo nginx -T` locally (read-only configuration output; it may contain sensitive material). Return only this application's `server_name`, proxy hop chain, upstream address/port, forwarded headers, TLS termination, static aliases and body-size limits. Identify Hestia's persistent customization mechanism so future Hestia regeneration cannot undo the setup. Do not publish the full multi-application configuration.

### MySQL and recovery inventory

Use the existing approved credential mechanism; `--password` prompts interactively and avoids command-line password values. Do not source `.env` as shell code. Fill host, port, user and schema from verified settings privately:

```bash
mysql --host='<observed host>' --port='<observed port>' --user='<observed user>' --password --database='<observed schema>' --execute='SELECT VERSION(), DATABASE(), CURRENT_USER(); SHOW GRANTS FOR CURRENT_USER(); SHOW TABLE STATUS;'
mysql --host='<observed host>' --port='<observed port>' --user='<observed user>' --password --database='<observed schema>' --execute='SHOW CREATE TABLE users; SHOW CREATE TABLE players; SHOW CREATE TABLE clubs; SHOW CREATE TABLE plan_session_tasks; SELECT COUNT(*) AS users_without_club FROM users WHERE club_id IS NULL; SELECT COUNT(*) AS stored_processiq_credentials FROM users WHERE processiq_password IS NOT NULL;'
```

If a table/column is absent, record that fact rather than creating it. Review all candidate schema changes against production, not just the tables above. Treat schema/grant output as restricted operational information. Request the current backup schedule, latest successful backup and restore-test dates, storage location, encryption/access policy, retention and whether uploads/keys are included. Inspect metadata only at the observed backup directory:

```bash
export BACKUP_DIR='<observed backup directory>'
stat -c '%U:%G %a %n' "$BACKUP_DIR"
find "$BACKUP_DIR" -maxdepth 1 -type f -printf '%TY-%Tm-%Td %TH:%TM %s %f\n'
```

No backup or restore is performed by these commands. Actual restore verification belongs to a separately authorized isolated rehearsal.

### Network, GitHub and HTTP inventory

Obtain SSH hostname/address, SSH port, allowed source networks, target account, verified host-key fingerprint, GitHub runner reachability and whether a jump host/private route is necessary. On the VPS, an administrator can read `sshd -T` to inspect effective SSH policy. Read public host-key fingerprints using `ssh-keygen -lf '<observed SSH host public-key file>'`; never read private host keys. A fingerprint from the VPS's trusted administrative session is the independent trust anchor; `ssh-keyscan` alone is insufficient.

Inspect GitHub Settings for branch protection/rulesets on `master`, required checks, Actions policy, environment restrictions and existing secret **names only**. Confirm repository visibility and available environment protection features. No GitHub configuration was inspected or changed by this audit.

After confirming this app's URLs, issue bounded GETs without redirect-following, and inspect only relevant response status/headers:

```bash
curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}\n' '<observed backend base URL>/login'
curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}\n' '<observed public HTTPS base URL>/login'
```

These GETs can generate ordinary access logs but do not intentionally change business data. A 200 login page does not verify authenticated flows, upload access or database completeness. Determine an operator-approved smoke procedure using existing data; avoid creating entities during this inventory.

## Recommended target architecture

1. PR validation and a `push` trigger limited to `master`. Protect master with required checks/reviews so a merge generates the production trigger. A push trigger also responds to direct pushes; rules must prohibit those if only PR merges may release.
2. GitHub-hosted runner by default, with read-only repository token permissions and actions pinned to reviewed commit SHAs. Use native OpenSSH for transfer/execution. No persistent runner on the shared production VPS. If the VPS is unreachable, agree a private network route or dedicated isolated runner before implementation.
3. Validate the exact event SHA using a pinned Node/npm runtime, `npm ci`, and `npm test` against a disposable MySQL instance on an isolated runner/VM. Do not provision containers for this solution. Keep test DB credentials separate and non-production; include required DDL privileges and deterministic environment. Confirm all six suites pass from a clean checkout.
4. Package that same SHA as source/assets plus a release manifest, excluding `.git`, `.env*`, `node_modules`, logs, uploads, caches and test artifacts. Preserve the lockfile and report template. Verify archive digest in transit; install runtime dependencies in the candidate using `npm ci --omit=dev` under the tested runtime. Do not copy local macOS node_modules to Linux.
5. Use a dedicated application deployment root, with `releases/<SHA-or-unique-id>`, `shared` and `current` beneath it; actual absolute root must come from inventory. Keep `.env`, persistent uploads and optional logs in shared storage. Link the candidate's `src/public/uploads` to the shared uploads directory before any app import. Persist customized templates where required. Keep backups outside public web paths.
6. Restrict SSH credentials to the deployment account and application scope, ideally through a fixed helper/wrapper, with no unrestricted sudo. Pin `known_hosts` from verified host keys; do not disable host-key verification. Transfer only validated artifacts; validate SHA/path inputs and archive contents.
7. Serialize production delivery with GitHub concurrency (`cancel-in-progress: false`) and an application-specific VPS `flock` covering backup, initialization, switch, restart and rollback. Reject stale/out-of-order SHAs before mutations, using the latest eligible master commit. GitHub concurrency is not a FIFO delivery guarantee: intermediate pushes may be superseded. If every merged SHA must actually be deployed, add a durable FIFO rather than relying on concurrency alone.
8. Prepare all candidate files/dependencies without running app code against production. Take and verify database/uploads backups under a defined consistency policy before initialization; pause business writes during first shared-upload cutover and any schema operation requiring it. The old process may still write while backing up: specify InnoDB-consistent DB backup and coordinated filesystem/write handling. Rehearse candidate startup on an isolated production clone first. Never call the initialization command a dry run.
9. For the initial conservative implementation, stop only the target PM2 app for the short activation window, atomically replace `current` using a temporary sibling symlink plus same-filesystem rename, then start/restart that target with explicit verified paths. Use a single fork instance, `watch: false`, no readiness-message option until implemented. Startup performs the reviewed DB changes. Avoid overlapping initializers and untested new code against the live DB while the old app serves traffic.
10. Verify resolved PID CWD/script/interpreter and expected SHA, bounded backend/public login checks, initialization logs and schema postconditions. The ecosystem must use either deliberately refreshed stable-symlink paths or an explicit selected release path; test that PM2 cannot keep executing a resolved old path. Preserve the production port and Nginx upstream.
11. On failure, restore the prior symlink/process configuration only when database compatibility permits; verify the previous SHA and HTTP response. Otherwise stop and follow the recovery runbook. Never automatically restore the database. Retain previous releases and report the deployment result/commit without leaking secrets. No default email/Slack messaging is required.

PM2 reboot persistence must be set up once under the correct owner and interpreter. Verify the saved process list is current after tested configuration changes; do not run unreviewed `pm2 save` against a daemon hosting unrelated applications. An eventual MySQL session store and graceful shutdown would improve continuity but are separate behavior changes, outside this audit.

## Files to create or modify later

| File | Proposed purpose |
| --- | --- |
| `.github/workflows/ci.yml` | PR/master validation with isolated MySQL and pinned runtime. |
| `.github/workflows/deploy-production.yml` | Master push, validated exact-SHA artifact, production environment, least permissions, serialization and SSH delivery. Keep validation required before deployment. |
| `ecosystem.config.cjs` | One app declaration using inventoried identity, CWD/script/interpreter, mode, log paths and environment contract; no secrets in source. |
| `scripts/deploy-production.sh` | Scoped, validated release preparation, shared links, locking, backup integration, atomic switch, targeted PM2 restart and verification. |
| `scripts/rollback-production.sh` | Explicit compatible-code rollback with prior release verification; no automatic SQL restore. |
| `.nvmrc`, `package.json` | Pin chosen Node line/exact runtime policy and supported engine range; npm version policy after validation. Do not regenerate lockfile casually. |
| `.env.example` | Document missing operational keys with safe placeholders and key continuity/bootstrap warnings. |
| `.gitignore` and packaging rules | Exclude runtime uploads going forward. Existing tracked files require a separate reviewed reconciliation/untracking change; ignore rules alone do not untrack them. |
| `docs/deploy-production.md` | Replace unverified examples/systemd preference with inventoried PM2 runbook, shared uploads, backup, restore and rollback rules. |
| Future app/test changes, only if agreed | Dedicated DB-aware readiness route, nonzero startup failure, graceful shutdown and MySQL-backed sessions; route/validation tests required. Not prerequisites to write scaffolding, but necessary if session continuity or stronger readiness is required. |

Only this audit document is created now.

## Required GitHub secrets and configuration

Proposed names below are new interface names, not claims about existing configuration. Store deployment credentials in a `production` environment restricted to `master`. To meet automatic-on-merge delivery, do not add a per-deployment approval requirement unless the owner changes that requirement.

| Name | Type | Purpose |
| --- | --- | --- |
| `PROD_SSH_PRIVATE_KEY` | Secret | Dedicated restricted deployment credential; never a personal/admin or shared root key. |
| `PROD_SSH_KNOWN_HOSTS` | Integrity-protected environment secret or variable | Independently verified host-key entry, with correct nonstandard-port syntax if applicable. |
| `PROD_SSH_HOST`, `PROD_SSH_PORT`, `PROD_SSH_USER` | Environment variables, or secrets if private topology policy requires | Actual SSH destination and deploy identity. |
| `PROD_APP_ROOT`, `PROD_PM2_APP_NAME`, `PROD_PM2_HOME`, `PROD_NODE_BIN`, `PROD_PM2_BIN`, `PROD_HEALTH_URL` | Environment variables or VPS-side fixed configuration | Observed app paths/identity and backend/public probe contract. Prefer fixed server-side values in the restricted helper. |

No long-lived GitHub PAT is needed for artifact-based delivery; use the workflow's scoped `GITHUB_TOKEN`. A VPS repository deploy key is unnecessary when transferring artifacts. Production DB passwords, session/encryption keys, bootstrap credentials and `.env` should stay on the VPS and in secure backup, not be copied into Actions. SSH passphrase or private-route credentials are conditional on the selected access method, not established requirements. Add no secrets until inventory and access design are approved.

## Required VPS preparation (future work only)

- Identify the existing app owner/PM2 daemon and establish a restricted deployment identity/helper without control over unrelated apps; inventory SSH access and host keys.
- Confirm/pin Node, npm, PM2 and their noninteractive absolute paths without upgrading other applications. Verify required shell tools, archive transfer, `flock`, MySQL backup clients, CA certificates and free disk/inodes.
- Choose the actual release/shared root within Hestia-compatible ownership constraints; give app identity write access only where needed (uploads, logs, temp), and read access to source/template/config. Secrets must be restricted to the required identities; no `chmod 777`.
- Back up/reconcile existing uploads and custom templates, preserve URLs and keys, then plan the first shared-directory cutover with a write pause. Confirm Nginx static aliases, if any, point to persistent content correctly.
- Verify database privileges/schema, clone-based upgrade rehearsal, backup consistency, retention, off-host copy and restoration. Define maintenance and DB recovery ownership.
- Test target-only PM2 activation/rollback and reboot recovery with the correct interpreter/CWD/env. Validate proxy headers/HTTPS and ensure backend access is restricted appropriately.
- Establish log rotation, temp cleanup, release retention, deployment timeouts and failure handling. Do not modify Nginx/Hestia merely to introduce CI delivery if existing routing works.

## Proposed implementation sequence and exit criteria

1. Collect read-only inventory above and resolve all production identifiers; confirm desired downtime/session policy and latest-eligible vs every-merge deployment semantics.
2. Validate runtime/dependency/test baseline in a clean isolated environment. Investigate failures without applying automatic package upgrades to production.
3. Rehearse the exact schema/data upgrade and compatible rollback against a disposable production clone; verify backups/restoration and key/upload continuity. Escalate incompatible DB changes into a separately reviewed release procedure.
4. Create and review CI, deployment/helper scripts, ecosystem and corrected runbooks using confirmed values. Exercise lock contention, stale SHA rejection, failed install, failed initialization, wrong PM2 CWD, failed HTTP probe and rollback without production credentials.
5. Prepare the VPS and GitHub configuration in a separately authorized implementation phase, preserving shared-host isolation. No preparation is executed by this audit.
6. Perform one supervised first release/cutover with backup and rollback checks; enable subsequent automatic master delivery only after the acceptance checks pass.

**Remaining implementation blockers after supplied inventory:** preservation in the release source of the now-reviewed production loopback-binding modification; daemon owner/home, PM2 version and reboot persistence; future release/shared root and upload reconciliation; effective production-mode value, encryption-key continuity and actual log/template configuration; remaining MariaDB schema comparison and upgrade compatibility; verified backup/restore coverage; proxy topology and HTTP redirect destination; SSH route/restricted identity/host key; GitHub protections/environment capability; accepted downtime/session-loss policy. Known identifiers are recorded in the inventory update below; no future root, deploy account or public URL is invented.

## Production inventory update from owner-provided transcripts

Sources: `fichero salida 1` through `fichero salida 4`, supplied after the initial audit. These are evidence transcripts, not executable instructions. Collection timestamps were not supplied; PIDs and resource figures are snapshots. Raw files are not copied into the repository.

| Confirmed observation | Evidence / implication |
| --- | --- |
| Host | Ubuntu 22.04.5 LTS, x86_64; collection session is `ubuntu`, UID/GID 1000, with sudo-group membership. This establishes the collecting identity, not conclusively the PM2 daemon owner. |
| Runtime/tool paths | Shell Node `v22.23.3`, npm `10.9.9`; `/usr/bin/node`, `/usr/bin/npm`, `/usr/bin/pm2`, `/usr/sbin/nginx`, `/usr/bin/mysql`, `/usr/bin/mysqldump`. PM2 version still missing. Target `/proc` executable resolves to `/usr/bin/node`; PM2 also reports Node 22.23.3. |
| Target process | PM2 name `soccer-report`, snapshot ID 1, PID 1722885, online, fork mode, watch false. No instances field was returned; do not infer a configured instance count from that omission. |
| Target paths | PM2 CWD and `/proc` CWD both `/var/www/spi-scouting-web`; script `/var/www/spi-scouting-web/src/server.js`. No release/shared/current layout is established by the supplied evidence. |
| Listener | PM2 inherited `PORT=3002`; socket inventory maps the same PID to `127.0.0.1:3002`. Verify deployed listener source because repository code does not explicitly bind loopback. |
| Shared daemon | Inventory also contains `soccertag`, `api-processiq`, `playertrack` and `pm2-logrotate`. Target logs are under `/home/ubuntu/.pm2/logs/`. These paths suggest a PM2 home, but do not prove daemon identity or an effective `PM2_HOME` override. Never restart/save all apps as part of delivery. |
| Capacity snapshot | Root filesystem ~55 GiB available, 6% inode use; memory ~5.6 GiB available, no swap. Capacity appears sufficient for initial planning but must be rechecked before release/backup; memory requirements are not measured. |
| File ownership | Project root `ubuntu:ubuntu 775`; `src` and `public` parents `root:root 755`; uploads and its three child directories `ubuntu:ubuntu 755`. Existing writes can work as ubuntu while code replacement may encounter mixed ownership. `.git` ownership has not yet been inspected. |
| Persistent files | Upload tree totals 320 KiB / 32 files, including unknown file types and possibly placeholders. Compare file manifests/database paths before any cutover; this is not proof of 32 user uploads. |
| Environment file | `/var/www/spi-scouting-web/.env` is `root:root 644`, hence readable by local identities that can traverse the directory. Treat permissions as a confirmed confidentiality risk; remediation must preserve read access for the actual app user. Do not change permissions during inventory. |
| Environment keys | `.env` includes PORT, NODE_ENV, DB connection keys, SESSION_SECRET, ADMIN_EMAIL/PASSWORD, LOG_LEVEL/FILE_PATH and APP_NAME; values were redacted. No APP_SECRET_KEY/PROCESSIQ_SECRET_KEY, upstream or template override key appeared in this file's listing. Their absence there does not prove no other configuration source exists. |
| PM2 environment | PM2 reports NODE_ENV undefined and no matching DB/secret keys. App-loaded dotenv values are not reflected back into PM2 daemon metadata. Effective NODE_ENV and key values therefore remain unknown; do not claim production mode is disabled or enabled. |
| Source parity | Production package.json matches the inspected local package.json. Production lockfile SHA-256 `374db7dfc67dd42a36f7dc99cbfb4d4187e252db4c55d65d072c848e7e23ae8c` matches local. This does not establish source/schema parity. |
| Git identity | Initial reads failed with dubious ownership; a subsequent owner-supplied transcript using sudo succeeded. Checkout HEAD is `24b2499d02ea9dee4459e2be731614e05c39e418`, with modified `src/server.js` and upload entries. This identifies checkout state, not conclusively the code loaded by the running process. No global Git trust change is required. |
| Incomplete discovery | `rg` is absent, so process and systemd inventory pipelines failed. No installation is needed: use grep for these reads. MySQL is listening on loopback 3306, but the app's actual DB destination/version remains unverified. SSH sockets include port 22, but Actions reachability and permitted authentication are unverified. |

### Follow-up: successful production Git inventory

The additional pasted transcript supersedes the initial Git failures. `sudo git` returned checkout HEAD `24b2499d02ea9dee4459e2be731614e05c39e418`. This differs from the locally audited commit; equal package/lock files do not imply equal application code. The process could also have loaded an earlier filesystem state, so checkout HEAD alone is not proof of the in-memory running release.

The worktree reports:

- Modified `src/server.js`: a production-local code change whose contents are still unknown. It may explain the loopback listener, but that is not confirmed until the diff is inspected. Preserve it and assess whether its behavior needs to be incorporated in version control before release automation.
- Modified entries for all 20 tracked JPGs and both upload `.gitkeep` files. Status alone cannot distinguish content changes from executable-mode changes; compare diff summaries before concluding images were replaced.
- Ten untracked image files: one club crest and nine player photos. Together with the 22 tracked upload files this accounts for the observed 32 files. All require preservation/reconciliation with database references, regardless of Git status.

**Additional first-release blocker:** blindly replacing this checkout would discard the local server change and can lose or replace live uploads. Do not use `git reset --hard`, `git clean`, an in-place checkout, or a transfer with delete semantics against the live tree. Capture/review the code diff and plan shared-upload preservation before any cutover; no cleanup or deployment is authorized by this audit.

Collect the following read-only diffs in the existing trusted checkout. Since the supplied sudo Git reads succeeded, the same form is shown; do not add a persistent global safe.directory exception. Review output locally for sensitive literals before sharing it.

```bash
sudo git -C /var/www/spi-scouting-web diff --no-ext-diff --no-textconv HEAD -- src/server.js
sudo git -C /var/www/spi-scouting-web diff --no-ext-diff --no-textconv --summary HEAD -- src/public/uploads
sudo git -C /var/www/spi-scouting-web diff --no-ext-diff --no-textconv --numstat HEAD -- src/public/uploads
```

The subsequently supplied server diff establishes the loopback-binding override (see follow-up below). Upload mode changes are confirmed; binary numstat alone does not establish byte equality. Binary image contents need not be posted. Remaining MySQL, backup/restore, SSH, proxy, PM2 ownership/reboot and environment questions are unchanged.

### Focused next read-only collection

Run in the existing VPS session. Commands below correct the failed/ambiguous reads; do not install tools, change ownership, set global Git trust, reload services or start another PM2 daemon. Inspect output for secrets before sharing.

```bash
ps -eo user,pid,ppid,comm | grep -Ei 'PM2|node|nginx|mysql|mariadb'
systemctl list-units --type=service --all --no-pager | grep -Ei 'pm2|nginx|mysql|mariadb|hestia'
stat -c '%U:%G %a %n' /home/ubuntu/.pm2 /home/ubuntu/.pm2/pm2.pid /var/www/spi-scouting-web/.git
cat /home/ubuntu/.pm2/pm2.pid
stat -c '%U:%G %a %n' /var/www/spi-scouting-web/.git/config /var/www/spi-scouting-web/.git/HEAD
sed -n '1,100p' /var/www/spi-scouting-web/src/server.js
```

If the PM2 PID file exists, use its numeric value to read the daemon's identity and only its PM2_HOME environment entry (never dump its complete environment):

```bash
ps -o user,pid,ppid,comm -p '<observed daemon PID>'
tr '\0' '\n' < /proc/'<observed daemon PID>'/environ | grep '^PM2_HOME='
```

An absent PM2_HOME entry is not an error; combine daemon identity, PID file and existing paths to establish the default. Only after confirming the running daemon/account/home, obtain `pm2 --version` from that owner's session. Read the identified boot unit with `systemctl cat '<observed PM2 unit>'` locally and return its nonsecret user/home/interpreter settings.

After inspecting ownership and confirming that this specific checkout is the intended trusted application repository, these per-command overrides allow read-only Git inspection without persisting a global exception:

```bash
git -c safe.directory=/var/www/spi-scouting-web -C /var/www/spi-scouting-web rev-parse HEAD
git -c safe.directory=/var/www/spi-scouting-web -C /var/www/spi-scouting-web status --short
git -c safe.directory=/var/www/spi-scouting-web -C /var/www/spi-scouting-web ls-files 'src/public/uploads/*'
```

Check production-mode equality without importing app code or printing secrets; this reads the file only and does not initialize MySQL:

```bash
cd /var/www/spi-scouting-web
node -e 'const fs=require("fs");const d=require("dotenv").parse(fs.readFileSync(".env"));console.log({dotenvNodeEnvIsProduction:d.NODE_ENV==="production",dotenvPortMatchesPM2:d.PORT==="3002",sessionSecretNonempty:Boolean(d.SESSION_SECRET),encryptionKeyNonempty:Boolean(d.APP_SECRET_KEY||d.PROCESSIQ_SECRET_KEY),logFileConfigured:Boolean(d.LOG_FILE_PATH),templateOverrideConfigured:Boolean(d.REPORT_TEMPLATE_PATH)})'
```

This checks file configuration, not values already loaded by the running process; do not assume an edited .env reflects its startup state. With no PM2 NODE_ENV override shown, the file result helps establish the next-start contract. Keep encryption key introduction/rotation separate until existing stored-credential compatibility is established.

The original MySQL, backup, Nginx/Hestia, SSH host-key, HTTP and GitHub collection sections still apply. Backend smoke URL can now use the observed `http://127.0.0.1:3002/login`; public HTTPS login URL is now confirmed by the supplied HTTP results below. MariaDB version/grants and four table definitions have now been supplied (see below); backup/restore evidence and remaining schema comparison are still missing. The safest architecture remains isolated releases plus shared persistence and a target-only PM2 restart; the observed mixed ownership and shared daemon strengthen the case for a restricted per-application deployment helper.

## Database inventory update from supplied SQL output

The owner supplied results for version/database/current-user, grants, table status, four CREATE TABLE definitions and two aggregate counts. No SQL was executed by this agent. The connection reports schema `player_iq_db` and account `player_iq@localhost`. **Owner subsequently confirmed that player_iq_db is soccer-report's configured DB_NAME.** The reported account is the one used for the supplied SQL connection; the application DB_USER value was not separately confirmed.

| Observation | Deployment consequence |
| --- | --- |
| Server version `11.4.13-MariaDB-ubu2204` | Production SQL evidence is MariaDB, despite the generic MySQL stack description. Use this same engine/version family for the upgrade/restore rehearsal; do not assume a successful test on a different MySQL engine proves compatibility. No database replacement is proposed. |
| Grants | Account has USAGE globally and ALL PRIVILEGES on the single reported schema. No global ALL PRIVILEGES or grant option is shown. This is broad schema-scoped access, not demonstrated least privilege. Rehearse the existing CREATE DATABASE IF NOT EXISTS and all model initialization under this account; do not widen grants to global/root or remove DDL rights blindly. |
| Tables | 29 tables listed, all InnoDB, including legacy club_teams, planning, scouting, recommendations and player-load tables. Their existence does not establish complete column/index parity. Preserve legacy data; do not drop apparently unused tables during delivery. |
| Collation | Listed table defaults and the four inspected definitions use utf8mb4_uca1400_ai_ci. Repository table declarations generally specify utf8mb4 without a collation; database creation specifies utf8mb4_unicode_ci. Inspect schema/server/connection defaults and rehearse new tables/foreign keys on the production clone. Do not normalize collations during deployment. |
| users definition | Club and default-team foreign keys are present; ProcessIQ credential columns, last_login_at and password_hash columns exist. No user records/password values are needed for this audit. |
| players / clubs definitions | Player photo_path/current-team relation and club crest_path/product_mode fields exist; inspected players definition has no club_id foreign key. This is an observation, not an instruction to alter integrity constraints. |
| plan_session_tasks definition | Extended task fields and explanatory_image_path exist, with its session foreign key and ordering index. This reduces uncertainty for this table only. |
| Aggregate counts | users_without_club = 0; stored_processiq_credentials = 1 (non-NULL values). Zero unassigned users does not establish valid scope for every role or application flow. One stored value does not reveal plaintext/encrypted format or prove successful decryption. |
| Table row statistics | SHOW TABLE STATUS row figures are not a verified exact data census. Zero estimates do not justify skipping backups, dropping tables or assuming module data is absent. |

The supplied grant text contains an authentication hash. It is intentionally **not reproduced** in this document or retained as a repository attachment. Redact authentication clauses from future grant outputs before sharing. Do not rotate credentials/keys as an automatic deployment action: evaluate any credential exposure privately and preserve access and encrypted-data continuity.

### Remaining database evidence

First confirm that the connection matches the target app, without sharing the .env values. Then use the same approved interactive connection mechanism to run only these read-only statements; no new credentials or paths are assigned here:

```sql
SELECT SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE();
SELECT @@character_set_server, @@collation_server,
       @@character_set_connection, @@collation_connection;
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
       COLUMN_DEFAULT, COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, ORDINAL_POSITION;
SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;
SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME,
       REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION;
```

Review metadata output for any sensitive defaults before sharing. A full schema comparison and candidate initialization on an isolated copy remain required; these SELECTs do not exercise startup permissions or prove upgrade success. Backups must include this confirmed target schema, uploads and required keys, and their restoration must be rehearsed. Use backup/restore tools compatible with the observed MariaDB server; a tool named mysqldump on PATH has not yet had its actual version established. Collect `mysql --version` and `mysqldump --version` as read-only client inventory. No live backup, restore, schema alteration or credential change is performed in this phase.

## Public HTTP smoke-check update

The owner supplied two curl results for `soccer-report.processiq.es/login`, both with a ten-second timeout and without redirect following:

| Request | Returned status | Confirmed scope |
| --- | --- | --- |
| `soccer-report.processiq.es/login` (scheme omitted) | 301 | This invocation received a permanent redirect. The Location header was not captured, so its destination is unverified. Use an explicit http:// URL for reproducible follow-up. |
| `https://soccer-report.processiq.es/login` | 200 | The public HTTPS login URL responded successfully from the owner's collection location, with normal curl TLS verification (no insecure flag). |

Public hostname is now established as `soccer-report.processiq.es`; use `https://soccer-report.processiq.es/login` as the proposed external smoke URL. These observations do not identify the proxy upstream, prove backend/process identity, validate login/database behavior, or demonstrate GitHub Actions SSH reachability. No response body or proxy configuration was supplied.

To inspect only the relevant response status and redirect location, without following redirects or printing cookies:

```bash
curl --silent --show-error --max-time 10 --dump-header - --output /dev/null 'http://soccer-report.processiq.es/login' | grep -Ei '^(HTTP/|Location:)'
curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}\n' 'http://127.0.0.1:3002/login'
```

Run the loopback check on the VPS; no backend response has yet been supplied. These checks generate ordinary request logs but do not intentionally modify business data. The supplied HTTPS success establishes a useful public baseline; schema rehearsal, upload/server-change preservation, backup verification, PM2 ownership/reboot and SSH access remain unresolved.

## Follow-up: production server diff and upload modes

The owner supplied the requested diffs. The complete reported server change adds:

```js
const HOST = process.env.HOST || "127.0.0.1";
```

and passes HOST as the second argument to app.listen. This explains the observed loopback binding and introduces an additional production-local environment setting, HOST, absent from the audited repository entry point. The actual HOST value need not be inferred: the observed socket is already confirmed as 127.0.0.1:3002.

**The code difference is now understood; preserving it remains a release requirement.** Before deploying repository source, incorporate and review the bind-host behavior in a separate implementation change, document HOST with a production loopback value/default, and verify against the existing proxy. Merely setting HOST in an ecosystem/.env file will not work with the currently audited repository code, which never reads it. Do not replace production source and inadvertently broaden the listener. No source behavior has been changed by this audit.

All 22 tracked upload entries have executable-bit changes from 100644 to 100755. The two .gitkeep files show zero line changes. The 20 binary images show '-' in numstat; that notation does not by itself prove identical file bytes. Executable permission is unnecessary for image/static placeholder files, but no chmod or ownership change is performed here. The ten previously identified untracked live images still require preservation.

If exact tracked-image content parity is needed, this read-only comparison suppresses mode-only changes and reports any remaining content changes, without printing images:

```bash
sudo git -c core.fileMode=false -C /var/www/spi-scouting-web diff --no-ext-diff --no-textconv --name-only HEAD -- src/public/uploads
```

An empty result means no tracked content differences reported by Git with mode differences ignored; it does not cover untracked files, which must still be included in backup/shared-upload reconciliation.

The next missing owner confirmations remain: whether player_iq_db is this application's configured DB_NAME, existing database/upload backup coverage, and whether a restore has been tested. Follow those with the already documented PM2 owner/home/reboot, environment, SSH and proxy checks. No further server diff is needed unless the production worktree changes.

## Historical owner confirmation: target database and missing backups

Superseded for backup existence/basic restore evidence by the verified backup update below.

The owner confirmed that the application's DB_NAME is player_iq_db and answered no to having backups of the database and uploads. Database/upload backup coverage is therefore **absent by owner report**, rather than merely undocumented. No restore rehearsal is evidenced; the owner did not separately answer the restore-test question.

**Hard blocker before the first production deployment:** establish a recoverable baseline for this database, the complete live upload tree (tracked and untracked), the production-local server modification, and required configuration/keys. Store secrets and backup data outside public web paths with restricted access, and keep a protected off-VPS copy. Do not commit these artifacts to GitHub.

The next preparation phase must first identify a suitable private backup destination and its ownership/capacity, inspect the installed MariaDB backup client version, and define a coordinated write pause so database references and uploaded/deleted files can be recovered together. Then create and verify the backup, and rehearse restoration into an isolated database/filesystem with the same MariaDB family. A successful dump or nonempty archive alone is not proof of recoverability. Do not test restoration over production or run application tests against the live database.

Backup creation, access changes and restore rehearsal are future work, not actions performed or authorized by the original audit-only scope. No backup destination, database credentials or retention policy is invented here. This confirmation does not authorize deployment. Other unresolved items, including PM2 owner/home/reboot, effective environment/key protection, SSH access and schema upgrade rehearsal, remain open.

## Reference material

Repository evidence is cited inline by file. External operational recommendations were checked against primary documentation on the audit date:

- [Node.js release policy](https://nodejs.org/en/about/previous-releases): select a supported production LTS and validate compatibility.
- [PM2 ecosystem declaration](https://pm2.keymetrics.io/docs/usage/application-declaration/): explicit CWD, interpreter, per-app environment and process options.
- [PM2 graceful shutdown](https://pm2.keymetrics.io/docs/usage/signals-clean-restart/): application cooperation is required for draining/cleanup.
- [GitHub deployment controls](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments) and [environment restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments): concurrency and branch-scoped deployment configuration.

Validation of this deliverable: repository/static configuration inspection and document review only. Tests were not run because this is documentation-only and the existing integration suite can modify the configured database/uploads; no isolated test database was established.

## Subsequent implementation: CI and liveness

The owner subsequently authorized minimum CI and healthcheck implementation.
GET /health and a PR-to-master validation workflow are now implemented locally;
see [CI.md](CI.md) for their contract, isolation, tests and validation limits.
Earlier statements about absent workflows/health endpoints describe the original
audit snapshot. No deployment workflow, VPS modification, schema-code change or
backup preparation was performed; production deployment blockers remain open.

## Verified backup and basic restore update — 2026-10-21

Evidence: owner-provided command output and confirmations, not direct agent VPS
access. This update supersedes earlier statements that no backup or restore
rehearsal exists. The owner explicitly authorized the short target-app stop and
executed the backup and isolated restore commands.

- PR #18 was merged into master (merge commit eedcd7a7fda81d4fee245f2b1eeb0a54b104ad85).
  Its GitHub CI passed 190 tests across seven suites. This did not deploy the app.
- Backup tool: /usr/bin/mariadb-dump, MariaDB 11.4.13. Destination:
  /home/ubuntu/spi-backup-GwkmI4YZ. An earlier authentication failure in a separate
  directory produced no successful backup; it must not be treated as one.
- Only soccer-report was stopped during the successful dump/archive and restarted
  by the shell exit trap. Other PM2 apps remained online in the supplied output.
  The owner subsequently confirmed the public HTTPS login returned 200.
- database.sql (~112 KiB) contains the player_iq_db dump, using single-transaction,
  quick, routines/events/triggers and hex-blob options. The archive (~424 KiB)
  includes .env, uploads, templates, the production-local src/server.js,
  package.json and package-lock.json. Both files and SHA256SUMS were shown as
  ubuntu-owned with mode 600; the directory was created under umask 077.
- SHA256SUMS verification passed on the VPS and again after the owner downloaded
  the backup to the Mac. No backup contents, credentials or hashes of passwords
  have been added to this repository. Backup encryption at rest is not verified.
- Read-only production queries reported no events, routines or triggers; the
  inspected dump had no matching top-level CREATE DATABASE/USE statements.
  Restore was performed through a new user limited to the temporary schema,
  without event/routine/trigger creation privileges, rather than importing as root.
- The SQL import into spi_restore_check_20261021 on the same MariaDB 11.4.13
  instance completed: 29 base tables, 5 users, 16 players, 16 reports and 336
  player_load_entries. These are restored snapshot counts, not a full content
  comparison with the live database; earlier SHOW TABLE STATUS estimates are
  not authoritative exact counts.
- Archive extraction into /home/ubuntu/spi-files-check-XrIGkU6D completed. Nonempty
  checks passed for .env, server.js, package.json, package-lock.json and the report
  template. All 32 upload files were recovered. No code from the extracted copy
  was started, and no production files were overwritten.
- The owner confirmed completing cleanup of the temporary schema/user, extracted
  directory and private client configuration. Cleanup was not independently
  inspected. The successful VPS backup and Mac copy were to be retained.

### Current recovery limits and next preparation

Backup existence, transfer integrity, SQL importability and basic file extraction
are now evidenced. Full application recovery, login/decryption of the stored
ProcessIQ credential, candidate schema upgrade, upload URL behavior and PM2
recovery have not been rehearsed. The archive is not a complete source/runtime
image: recovery also needs the identified Git commit plus local override, runtime
and process configuration. Environment/key continuity still requires verification.
Stopping this app does not by itself prove no other process writes the same DB.

A recurring backup schedule, retention, protected off-host storage policy and a
fresh pre-release backup are still required; this single snapshot is not a
permanent deployment safeguard. Next collect the PM2 daemon owner/home, PM2
version and boot-unit configuration, then design the release/shared-upload layout
and a separately reviewed candidate startup rehearsal. Do not deploy or alter
production source merely because the basic restore succeeded.

## PM2 daemon and boot-unit inventory update

Owner-supplied output confirms PM2 6.0.14 and daemon PID 1468648 running as
ubuntu, parent PID 1, with daemon home /home/ubuntu/.pm2. PM2_HOME is unset in
the collecting shell; daemon output establishes the effective home. The earlier
project-directory PM2_HOME_DIR value was a mistaken inventory variable, not the
observed daemon home.

systemctl list-unit-files reports pm2-ubuntu.service enabled and
pm2-root.service disabled. The latter still exists; this is not evidence of an
active root daemon. No service was enabled, disabled or restarted in this step.
The enabled flag alone does not prove a successful reboot restore: inspect the
ubuntu unit's User, environment/PATH/PM2_HOME, ExecStart/ExecStop and live status,
and compare its saved dump with the intended processes. Do not run pm2 save
or pm2 startup during inventory because the daemon manages several applications.

## PM2 service and saved process-list confirmation

Further owner output confirms /etc/systemd/system/pm2-ubuntu.service is active /
running, Type=forking, User=ubuntu, PM2_HOME=/home/ubuntu/.pm2 and
PIDFile=/home/ubuntu/.pm2/pm2.pid. ExecStart invokes
/usr/lib/node_modules/pm2/bin/pm2 resurrect. ExecReload reloads all applications
and ExecStop kills the shared daemon; do not use service-level reload/restart for
this app's deployment. The PATH line supplied through the pager was truncated,
so the complete boot PATH remains unverified.

The sanitized saved dump includes soccer-report, soccertag, api-processiq and
playertrack, each marked online in fork mode. Saved soccer-report CWD and script
match /var/www/spi-scouting-web and its src/server.js; interpreter is node rather
than an explicit absolute binary. This establishes a configured resurrection
list, not a successful reboot rehearsal or proof of every saved environment value.

/home/ubuntu/.pm2/dump.pm2 is ubuntu:ubuntu mode 664. This is overly permissive
for a file that can contain runtime secrets: group members can modify it and
other identities may read it if parent traversal permits. Parent-directory mode
has not been supplied, so effective access cannot be concluded from file mode
alone. Plan owner-only mode 600 for dump.pm2 and any existing dump.pm2.bak, with
parent access verified. Do not print raw dump contents or apply recursive chmod.
No permissions, service state or saved process list were changed by this update.

## Environment flags and secret-file permissions confirmed

Owner output confirms .pm2 is ubuntu:ubuntu 775, dump.pm2 and dump.pm2.bak
are ubuntu:ubuntu 664, and application .env remains root:root 644. The previously
observed /home/ubuntu 750 limits traversal by other identities; group-readable
and group-writable PM2 state still warrants restricting the dump files. Effective
access may also depend on ACLs and privileged identities, which were not audited.

Parsing the application .env without importing app code reports
NODE_ENV=production, a nonempty SESSION_SECRET and no nonempty APP_SECRET_KEY or
PROCESSIQ_SECRET_KEY. This confirms file configuration, not secret strength or
the absence of every possible key source in a running process. Do not add a key
blindly: one ProcessIQ credential is stored and its format/key continuity must
be assessed separately.

Next proposed permission-only preparation: mode 600 on both PM2 dump files;
root:ubuntu ownership and mode 640 on the application .env, retaining root write
and ubuntu-group read for the observed application identity. No recursive mode
changes, PM2 save, environment value edits or restarts are required. These are
instructions for the owner; execution has not yet been confirmed.

## Permission preparation verified by owner

Subsequent stat output confirms dump.pm2 and dump.pm2.bak are ubuntu:ubuntu 600,
and /var/www/spi-scouting-web/.env is root:ubuntu 640. The owner ran test -r as
ubuntu and confirmed .env remains readable. This supersedes the earlier file-mode
findings for those three files. No secret values, encryption keys, source code
or process configuration were changed in this permission-only step. Future PM2
save/backup operations should have their resulting file modes checked again.

## Nginx/Hestia domain routing inventory

Owner-supplied filtered nginx -T output identifies these active config files:
/etc/nginx/conf.d/domains/soccer-report.processiq.es.conf and the corresponding
soccer-report.processiq.es.ssl.conf. The HTTP server redirects location / with
301 to https://$host$request_uri. The HTTPS server's location / proxies to
http://127.0.0.1:3002, matching the observed target process socket. TLS terminates
at Nginx; certificate and include paths are beneath the observed Hestia account
/home/devlaf/conf/web/soccer-report.processiq.es. This is a distinct account from
the ubuntu application/PM2 owner; do not conflate ownership or relocate app files
into its web tree without reviewing access.

The excerpt shows HTTP/1.1, Upgrade and Connection headers plus 300-second
proxy read/connect/send timeouts. Lines containing the remaining forwarded
headers were omitted by the filter, so HTTPS/client-IP forwarding is not yet
fully verified. No root or alias appeared in the supplied target-server excerpt;
this does not prove absence in all included configuration. Domain include globs
for nginx.conf_* and nginx.ssl.conf_* exist. Hestia template selection and
regeneration persistence are not yet established. ACME challenge response values
were omitted from this report.

The observed routing supports keeping the existing backend port while changing
PM2 release paths; a releases/shared layout does not inherently require Nginx
changes. Do not edit generated vhosts, restart Nginx or alter Hestia templates in
this inventory phase. Full target HTTPS config and applicable custom includes
must still be checked before declaring proxy configuration complete.

## Complete HTTPS proxy configuration confirmed

The owner's full target vhost confirms Host=$host, X-Real-IP=$remote_addr,
X-Forwarded-For=$proxy_add_x_forwarded_for and X-Forwarded-Proto=https, in addition
to the previously observed loopback upstream. This matches the audited one-hop
trust-proxy setting for the shown Nginx-to-Node path. Any external proxy/CDN
layer remains outside the supplied evidence.

readlink -f resolves the active SSL vhost to
/home/devlaf/conf/web/soccer-report.processiq.es/nginx.ssl.conf. The shown main
server contains no root/alias; applicable custom includes still require review
if static routing is suspected. Hestia account devlaf owns the domain namespace,
while ubuntu runs the application. The current file alone does not establish
which Hestia template generated it or whether manual proxy edits survive a domain
rebuild. Verify template selection before changing generated configuration. No
Nginx reload, Hestia rebuild or port/path change was performed.

## Hestia domain template selection confirmed

Owner output from v-list-web-domain confirms domain account devlaf, proxy template
PROXY=scouting, TPL=default and BACKEND=default. SSL and Let's Encrypt are enabled;
SSL_FORCE is no even though the active HTTP vhost redirects to HTTPS. The domain
is not suspended. Its Hestia DOCUMENT_ROOT is
/home/devlaf/web/soccer-report.processiq.es/public_html/, distinct from the Node
source tree. PROXY_EXT lists static extensions, but the observed active vhost
proxies location / to Node; template/include contents, not metadata alone,
determine actual static routing.

Proxy template selection is now known. The scouting .tpl/.stpl files must still
be located and inspected to verify that regeneration preserves the loopback
upstream, headers and HTTP redirect; no rebuild was requested or performed.
Do not replace the selected template with default or use the Hestia document
root as the application release root solely based on this metadata.

## Hestia scouting template contents verified

Owner supplied both /usr/local/hestia/data/templates/web/nginx/scouting.tpl and
scouting.stpl. The HTTP template explicitly redirects location / with 301 to
https://$host$request_uri, explaining the redirect despite SSL_FORCE=no. The TLS
template specifies http://127.0.0.1:3002 and the same Host, X-Real-IP,
X-Forwarded-For, X-Forwarded-Proto=https, upgrade headers and timeouts as the active
vhost. Both preserve the domain-specific custom include globs. No static root or
alias is declared in these template bodies.

The selected templates therefore encode the observed routing; it is not solely
an unexplained edit to the generated vhost. No actual Hestia rebuild/reboot was
performed, so this is template correspondence rather than a regeneration test.
The scouting upstream is hard-coded to this port: do not reuse this template for
another app expecting a different port without separate review. Preserve custom
templates in infrastructure recovery planning; the existing application archive
does not include them. No Nginx or Hestia modification is needed for the proposed
release/shared design while the backend port remains 3002.

## Filesystem layout inventory and proposed first cutover

Owner output shows /var/www is ubuntu:ubuntu 755 and the existing application
root /var/www/spi-scouting-web is ubuntu:ubuntu 775. No top-level symlinks were
returned by the supplied find. du reported 84 MiB for the application; separate
node_modules/uploads totals were not returned, since overlapping du arguments
can be counted once. The previously collected upload total remains separate
evidence. No paths were created or moved in this step.

Proposed new root (not an observed or created directory):
/var/www/spi-scouting-deploy, with releases/, shared/ and current beneath it.
First verify that this proposed path is unused. Retain the existing
/var/www/spi-scouting-web installation intact during initial preparation; do not
turn it into a symlink or copy its live uploads while writes are occurring.

Shared would contain .env, uploads/ and any configured persistent logs or custom
template. Each candidate release would link .env and src/public/uploads to these
shared paths before any application import. A write pause and fresh backup are
required for final upload/config synchronization. Protect secrets with the
verified root/ubuntu access contract; PM2 dump backups contain environment
secrets and must also be kept private. Do not assume current relative log paths
or report-template overrides without inspecting their nonsecret destinations.

Before cutover, version and test the production HOST/loopback behavior, verify
session/encryption-key continuity, rehearse the candidate on an isolated MariaDB
clone, and prepare a per-app PM2 declaration/rollback procedure. Keep port 3002
and existing Nginx routing. Use explicit selected release CWD/script paths when
activating the target PM2 process; changing current alone does not prove PM2
executes the new release. Do not kill/reload the shared daemon. Record the
original CWD/script/environment and preserve compatible database semantics for
rollback; untouched old code cannot reverse startup schema/data changes.

No release preparation, PM2 update, shared-state migration or production
cutover is performed by documenting this proposal. GitHub-to-VPS restricted SSH
access and automated delivery remain later work.

## Release directory preparation confirmed by owner

Owner confirmed creating /var/www/spi-scouting-deploy and releases/ as
ubuntu:ubuntu 750, with shared/ as ubuntu:ubuntu 700. These are now observed,
created directories, superseding the earlier proposed-only status. No current
symlink, shared configuration/uploads copy, candidate release or PM2 path switch
was performed in this step; the original app directory remains the active path.

The production-local HOST behavior is being incorporated in the separate
production-host-binding branch: server.js reads HOST with default 127.0.0.1 and
passes it to app.listen, preserving PORT and initialization ordering. This
matches the reviewed live override, but changes the repository's historical
all-interface default for other installations. Explicit HOST overrides remain
available. .env.example documents HOST/PORT; server unit tests exercise defaults,
overrides, initialization gating and failure. This code has not been deployed.

HOST change local validation: eight suites / 194 tests passed with Node 22.23.3,
TZ=Europe/Madrid and the dedicated local MySQL test schema. JavaScript syntax
and git diff whitespace checks passed. No production database or socket was
used by the new server tests, which mock app/initDb/logger.

## Candidate installation and dependency audit update

Owner confirmed candidate /var/www/spi-scouting-deploy/releases/rehearsal-M7Oww7Mk
at exact merged commit a9ea2ad9c2b14f7157926a18fa8f9f2a9c7a2fe3. Node 22.23.3,
npm 10.9.9 and npm ci --omit=dev completed; git status returned no changes.
No .env, process startup or production activation has been performed.

The owner's runtime npm audit reports seven affected packages: body-parser (low),
brace-expansion (high), morgan (moderate), mysql2 (high), proxy-addr (critical),
qs (moderate) and xlsx (high). It reports fixes through npm audit fix for the
first six, but this is not proof that any resulting upgrade is compatible or
that all findings will clear. Review exact dependency/lockfile changes on a new
branch and run the complete tests/CI; do not patch the VPS candidate in place.

The critical proxy-addr advisory GHSA-jqcg-44mw-7w3h specifically concerns malformed
IPv4-mapped IPv6 trust subnets; audited app.js uses numeric trust proxy=1, so that
specific trigger was not found. The affected installed version should still be
updated; severity alone is not proof of exploitability of this app configuration.
mysql2 auth downgrade depends on a malicious server/MITM; the compressed-protocol
finding needs separate reachability review (compression is not explicitly enabled
in the inspected db.js). morgan is declared but no use was found in src.

xlsx is actively used to parse uploaded workbooks in player/evaluation/player-load
imports, so export-only exemptions do not apply to the whole app. The official
advisories explain that the npm-hosted xlsx distribution has no patched release;
fixed SheetJS releases are distributed separately. No fix available in npm audit
does not mean no upstream remediation exists. Evaluate a pinned official upstream
artifact or replacement, preserving XLSM/VBA template export and testing import
compatibility. No dependency or lockfile change is made by this audit update.

References: https://github.com/advisories/GHSA-jqcg-44mw-7w3h,
https://github.com/advisories/GHSA-3f6p-5ww8-9rcr,
https://github.com/advisories/GHSA-4r6h-8v6p-xvw6 and
https://github.com/advisories/GHSA-5pgg-2g8v-p4x9.

Recommendation: resolve/review dependency findings before public candidate
activation. Isolated startup rehearsal can be designed separately; no evidence
of compromise is established by the audit report alone.

## Compatible dependency remediation prepared

On dependency-security-fixes, a targeted npm update regenerated the lockfile with
Node 22.23.3 / npm 10.9.9 without changing package.json or application code:

| Package | Previous locked version | Updated locked version |
| --- | --- | --- |
| body-parser | 2.2.2 | 2.3.0 |
| brace-expansion (runtime) | 2.1.1 | 2.1.7 |
| morgan | 1.10.1 | 1.12.1 |
| mysql2 | 3.18.2 | 3.24.6 |
| proxy-addr | 2.0.7 | 2.0.8 |
| qs | 6.15.2 | 6.16.1 |

Necessary transitive updates include type-is/content-type, iconv-lite,
side-channel and sql-escaper. Other existing brace-expansion copies are also
updated within their current major versions (1.1.21 and 5.0.12). Obsolete denque
and morgan's nested on-finished entry disappear from the resolved graph. No
forced major upgrade, blanket audit fix, npm upgrade or dependency override was
used. Keep using npm ci; package.json ranges alone do not ensure these versions.

A fresh npm ci passed, and all eight suites / 194 tests passed on Node 22.23.3
against the dedicated local test database. Post-change npm audit --omit=dev
reports one high finding (xlsx), zero critical, zero moderate and zero low,
versus seven affected packages before. This is a runtime audit snapshot, not a
claim that all development dependencies or deprecated libraries are remediated.
No test was weakened, skipped or removed. xlsx remains 0.18.5 unchanged, with its
uploaded-file parsing risk and XLSM compatibility work explicitly pending.

These lockfile changes are local/PR preparation, not installed on the VPS.
Candidate rehearsal-M7Oww7Mk remains at the previous merged commit and lockfile;
prepare a new exact-commit candidate after review/merge, rather than patching
that candidate with npm audit fix. The retained xlsx risk needs separate
resolution or explicit evaluated risk acceptance before public activation.

## SheetJS remediation prepared separately

The owner selected resolving xlsx in a separate PR. sheetjs-security-update is
based on the pending dependency-security-fixes branch, retaining its fixes.
SheetJS CE 0.20.3 is installed from the authoritative versioned CDN tarball with
SHA-512 lockfile integrity, preserving the xlsx CommonJS API and XLSM template.
Clean installation and eight suites / 195 tests passed on Node 22.23.3. The added
integration test verifies actual report download, full VBA bytes, sheet names,
formulas and merged ranges. Runtime npm audit now reports zero findings; external
tarball coverage limits and known-advisory version thresholds are documented in
[SHEETJS.md](SHEETJS.md). No audit exclusions are used. The earlier xlsx finding
is superseded for this branch only, not for the unchanged VPS candidate.

Merge dependency PR #20 first. The SheetJS PR targets master for the existing CI
trigger and temporarily includes #20's prerequisite commit until it is merged.
No production/candidate update or schema change has been performed. A fresh
post-merge candidate and isolated MariaDB startup rehearsal remain necessary.

## Updated candidate isolated startup and HTTP checks

Owner confirmed PR #20 merged as e28c7fdc51b22c9c7d5cf4f6c8275c26ecef684f and
PR #21 as 4c1e3811030644cdcb25cc7bcb76d0d727158506. The new candidate at
/var/www/spi-scouting-deploy/releases/rehearsal-5MGigLAe is checked out at the
latter exact commit. Production dependencies installed with Node 22.23.3 /
npm 10.9.9, with zero reported runtime npm audit findings; the multer deprecation
warning remains separate. This supersedes the old candidate's audit result only
for the new candidate, not the currently active production installation.

Owner restored 29 tables into spi_rehearsal_20261021 with the restricted
spi_rehearsal@127.0.0.1 account, and generated a separate mode-restricted .env
with new DB/session credentials, HOST=127.0.0.1, PORT=3102 and NODE_ENV=production.
ADMIN_PASSWORD is empty, no encryption key was introduced, and PROCESSIQ_API_URL
points at an intentionally unavailable loopback destination to prevent normal
upstream imports. The application was not pointed at the production schema.
The backup upload extraction/move procedure was supplied; the owner has not yet
provided its file-count output. Verify DB-to-file references before declaring
asset recovery complete for this candidate.

Owner started node src/server.js in the foreground under an environment cleared
with env -i. Logs report successful initialization/listening on 3102, no new
bootstrap superadmin, and the expected missing-secret-key warning. No visible
initialization error was supplied; this is not proof that every schema invariant
holds, since some model ALTER errors can be swallowed/logged.

Subsequent owner checks confirm /health returns exactly {"status":"ok"} with
HTTP 200, /login returns 200, and ss maps candidate PID 2040407 to
127.0.0.1:3102. Public production /login still returns 200. The candidate is a
foreground rehearsal, not a PM2 production release; no current symlink, shared
upload activation, proxy change or production schema initialization occurred.
Authenticated scope/login flows, upload references and ProcessIQ credential
continuity remain to be verified. No successful deployment or automatic
production delivery is claimed.

## Rehearsal asset references and authenticated access verified

Owner confirmed 32 files under the candidate uploads tree. The read-only check
against the guarded rehearsal DB configuration inspected nine nonempty asset
references from players.photo_path, clubs.crest_path and
plan_session_tasks.explanatory_image_path: zero missing and zero unexpected
paths. This supersedes the earlier missing candidate file-count evidence. The
check does not cover template asset references, file contents/decoding or every
possible URL consumer.

Owner ran the credential-prompted loopback login smoke against port 3102,
simulating the existing proxy's X-Forwarded-Proto=https and forwarding the returned
cookie only in memory. Result: login 302 to /dashboard, a session cookie received,
and authenticated /account and /dashboard both HTTP 200. No password/cookie was
recorded here. This validates one restored account and these routes, not every
role/club scope, full browser TLS flow, or ProcessIQ credential decryption.
Only rehearsal last-login/session state was intentionally changed by that check.

Candidate remains a foreground process, not the active PM2 application. Before
production cutover: verify all necessary scoped business flows/credential
continuity, prepare and review a scoped PM2 declaration and explicit rollback,
confirm persistent log/template destinations, take a fresh coordinated backup,
and synchronize uploads/config under a write pause. Shared activation, current
symlink changes, port 3002 takeover and automated delivery remain unperformed.

## Foreground rehearsal stopped cleanly

Owner confirmed the port-3102 socket inventory returned only its header after
stopping the foreground candidate; public production login still returned HTTP
200. The trial process is no longer listening. No PM2 process, Nginx upstream,
production database or current symlink was switched. Rehearsal database/assets
remain isolated and retained pending the next preparation step.

Before drafting the final PM2 activation/rollback contract, collect effective
LOG_FILE_PATH and REPORT_TEMPLATE_PATH (file plus PM2 overrides), resolving
relative paths against the confirmed active CWD. A release-path change must not
silently strand logs or omit a production-specific spreadsheet template.

## Persistent log/template destinations and activation plan preparation

Owner supplied .env parsing resolves LOG_FILE_PATH to
/var/www/soccer_report/shared/logs/app.log and the effective template fallback to
/var/www/spi-scouting-web/src/templates/report_template.xlsm. The sanitized PM2
inspection confirms original CWD and null LOG_FILE_PATH/REPORT_TEMPLATE_PATH
overrides. Keep the current absolute log destination, subject to permission and
rotation checks, rather than inventing a new log path during cutover.

production-pm2-plan adds a reviewable ecosystem.config.cjs and
[ACTIVATION_PLAN.md](ACTIVATION_PLAN.md), without executing PM2 or any production
activation. The declaration requires an explicit full-SHA child of the known
releases root, targets only soccer-report in one fork instance, fixes the observed
interpreter/listener/log destinations, and plans a shared production-template
copy. It rejects rehearsal/implicit-current selections. The shared template and
configuration/uploads are not yet copied; applying this config now is premature.

The plan explicitly includes fresh backup/final synchronization, private
original target metadata, isolated PM2 behavior rehearsal, current-pointer
verification and shared-file consistency during rollback. PM2 save is a separate
reviewed all-daemon persistence action, not a target-only deployment step.
No automated delivery, deployment script or production transition is created.

## Log and template permissions confirmed

Owner stat output confirms /var/www/soccer_report/shared/logs is ubuntu:ubuntu
775, app.log is ubuntu:ubuntu 664 and the production report_template.xlsm is
root:root 644. A test -w run as ubuntu confirms the existing log is writable.
These findings support keeping the current absolute log destination and reading
the existing template for a shared copy; neither was moved or permission-edited.
Rotation policy and log confidentiality/access beyond these modes remain separate
operational checks. The application/archive permission changes previously
recorded do not imply these existing log modes were tightened.

## Isolated PM2 replacement and rollback rehearsal completed

Owner confirmed PR #22 merged as aeff9a19e8450fd8766c9d29a98131b10e18607f.
A disposable PM2 home was created at /home/ubuntu/spi-pm2-trial-gNxOqAXN/pm2,
separate from /home/ubuntu/.pm2. Two auxiliary HTTP scripts under release-a and
release-b listened only on 127.0.0.1:3102 and identified their directory in JSON.
They used neither the real application nor a database or production secrets.

Owner outputs confirm isolated process spi-pm2-rehearsal was started as A,
deleted/recreated with explicit script/CWD/interpreter as B, then deleted/recreated
as A for rollback. Responses identified each expected release with HTTP 200.
Brief connection refusal during startup was followed by successful bounded curl
retries. Initial trial logs showed no errors. The owner was instructed to kill
only the explicitly prefixed disposable PM2 daemon; subsequent output confirms
no listener on 3102 and public production login HTTP 200. Daemon exit itself was
not independently inspected; the trial directory is retained.

This validates basic scoped delete/start path selection and code rollback in a
separate PM2 home. It does not exercise ecosystem.config.cjs against a real app,
shared upload synchronization, database backward compatibility, PM2 save/resurrect,
boot recovery, current-pointer atomicity or failure injection. These limits remain
part of the supervised activation plan; no production process was replaced.

## Shared report template prepared and compared

Owner confirmed creation of shared/templates and copying the existing production
report_template.xlsm to
/var/www/spi-scouting-deploy/shared/templates/report_template.xlsm. cmp completed
successfully, and stat reports ubuntu:ubuntu 600 on the copy. This supersedes the
planned-only status of this specific template destination. The active production
template was not replaced; .env/uploads and PM2 activation are still separate.
Refresh/compare again during final synchronization if the source changes.

## Shared production environment snapshot verified

Owner output confirms /var/www/spi-scouting-deploy/shared/.env is root:ubuntu 640,
byte-identical to the original production .env by cmp and readable by ubuntu.
No values/keys were changed or printed; this is a private configuration copy,
not a process environment update. It supersedes planned-only status for the shared
.env. Recompare/refresh during final cutover synchronization; the active process
still runs from the original checkout, with no current pointer switched.

## Initial shared uploads copy verified

Owner confirmed copying the active uploads tree to
/var/www/spi-scouting-deploy/shared/uploads without moving/removing source files
or using rsync delete. Source and shared copies each contain 32 regular files;
checksum-based recursive dry-run reported no content differences in that direction
at collection time. Shared creation used private directory/file permissions.
No active app link was changed. Because the original app remains writable, this
is a preliminary snapshot: final synchronized additions/updates/deletions require
a write pause and fresh backup before activation. The one-way dry-run is not a
proof against extra destination-only files after later synchronizations.

## SHA-named production release prepared without activation

Owner confirmed preparing
/var/www/spi-scouting-deploy/releases/aeff9a19e8450fd8766c9d29a98131b10e18607f
at exact reviewed PR #22 merge SHA, with ecosystem.config.cjs present and no .env
before dependency installation. Node 22.23.3 / npm 10.9.9 were guarded in the
supplied preparation procedure. npm ci --omit=dev completed with 126 packages;
runtime audit reported zero findings. Multer's deprecation warning remains and
is not a zero-risk guarantee. No process startup, current-pointer update or PM2
change was part of that preparation. Shared linking/preflight is the next step.

## Production release links and PM2 declaration inspected

Owner confirms the SHA release .env resolves to the prepared shared/.env and
src/public/uploads resolves to shared/uploads. The repository upload directory
was preserved separately as repository-uploads. Reading ecosystem.config.cjs
(without importing app/server code) reports only soccer-report, the exact SHA
CWD/script, /usr/bin/node, 127.0.0.1:3002 and the prepared shared report-template
path. No SQL initialization, PM2 activation or current pointer was changed by
these steps. This production-linked release must not be started as a trial.

Next prepare a private target-only rollback declaration from the current daemon,
then verify final consistency/backup before the explicit activation window.
Because the old app hardcodes its own upload directory, rollback after writes
resume must share the authoritative uploads too; original upload-path relinking
(if chosen) requires a separately authorized write pause and preservation of the
original directory. Parent public directory ownership may require sudo for that
scoped filesystem change. Do not silently fall back to the old stale copy.

## Private target rollback declaration captured

Owner confirmed creation of
/var/www/spi-scouting-deploy/shared/recovery-S4b0DS0d/rollback.ecosystem.config.cjs,
ubuntu:ubuntu 600, from the checked online soccer-report entry at the original
CWD/script. The generation procedure retained captured target environment values
privately and explicitly selected the observed interpreter/listener/log and shared
template. No file contents/secrets were supplied or committed. It is prepared
rollback metadata, not evidence of applying it to the real application.

Repository diff from inventoried production checkout 24b2499 to release aeff9a1
shows no db.js, initDb.js or model/schema-initializer changes. Runtime dependency
changes still require verification, and startup still performs the existing
schema/data initialization; absence of a new migration is not absence of writes.
Before activation, revalidate original source/environment drift, current backup
and final shared-state consistency and obtain explicit cutover authorization.

## First authorized production activation: HTTP checks passed

Owner explicitly authorized the production stop/activation and supplied complete
successful output from the reviewed first-activation script. Fresh private backup:
/home/ubuntu/spi-preactivation-CbJkbuGH. SHA256 verification passed for database.sql,
application-files.tar.gz and the private target rollback declaration. Only the
soccer-report PM2 entry was stopped/deleted/recreated; no SQL restoration occurred.

The successful script path performed final shared uploads synchronization including
deletions, refreshed/compared configuration/template, preserved original uploads
as uploads.before-aeff9a19e8450fd8766c9d29a98131b10e18607f, and linked the original
code's uploads path to shared/uploads for code rollback consistency. The new
release also uses shared .env/uploads and the configured shared report template.

PM2 now reports soccer-report ID 5, PID 2048649, with CWD and script in
/var/www/spi-scouting-deploy/releases/aeff9a19e8450fd8766c9d29a98131b10e18607f.
The script verified the actual /proc PID CWD. Private pre/post comparisons reported
other application/module PIDs and statuses unchanged. Initial loopback connection
refusals were followed by successful bounded retries. Script assertions passed
for exact backend/public health JSON, public login HTTP 200 and the atomic current
pointer update. This is an actual supervised production activation, superseding
earlier preparation-only status; no automated GitHub deployment exists yet.

PM2 save was deliberately not executed. Post-activation authenticated/business
smoke checks, initialization log inspection, reviewed process-list persistence,
post-save dump permissions and off-VPS transfer of the fresh backup remain open.
Do not claim a reboot test or successful live rollback: those were not executed.

## Owner post-activation functional confirmation

Owner reports the requested post-activation checks correct after being asked to
verify fresh login, dashboard/player photos and report Excel download, and to
inspect recent logs. No raw log output or browser artifacts were supplied; this
is an owner functional confirmation rather than independently observed coverage
of every role/module. Production release remains aeff9a1; reviewed PM2 persistence
and transfer of the fresh preactivation backup are the next operational steps.

## Reviewed post-activation PM2 persistence saved

Owner supplied successful output from the guarded persistence block: target
release and other application PID/status comparisons passed before pm2 save.
The old dump.pm2 and any dump.pm2.bak were copied into a private mktemp directory
under /home/ubuntu/spi-preactivation-CbJkbuGH before saving. The supplied procedure
then restores mode 600 on the current PM2 dump files.

The saved target CWD is the exact aeff9a1 release directory. Sanitized saved names
are soccertag, api-processiq, playertrack and soccer-report. No unrelated process
was intentionally restarted or removed. This supersedes the pending-pm2-save
status of earlier activation notes; it establishes saved configuration, not an
actual reboot/resurrection test. Owner has not yet supplied transfer/integrity
confirmation for the fresh preactivation backup and PM2 recovery copies off-VPS.
The older backup's successful Mac transfer does not cover this new snapshot.

## Fresh activation backup off-VPS integrity confirmed

Owner supplied successful Mac-side transfer and SHA256 verification for the fresh
spi-preactivation-CbJkbuGH snapshot: application-files.tar.gz (~5.8 MiB),
database.sql, other-apps-before.json, private rollback declaration and both PM2
pre-save dump files under pm2-before-save-MKP20SJ5. All six file checks passed.
This supersedes the pending-transfer status for this snapshot. No private backup
content is included in the repository. It is a preactivation recovery baseline,
not a continuously current copy of subsequent production writes or proof of a
new full-source restore/reboot exercise. Recurring schedule/retention and backup
storage encryption remain separate operational decisions.

Manual release activation, functional checks, saved PM2 state and off-host backup
are now evidenced. Automatic master-triggered GitHub delivery is still absent.
Next establish the approved SSH destination/port, independently verified server
host key and restricted deployment-key/command contract before configuring any
GitHub deployment secrets or enabling a production deployment workflow.

## SSH destination and disabled automation preparation

Owner confirms SSH at 51.75.255.4:22, PermitRootLogin no,
PubkeyAuthentication yes, PasswordAuthentication yes, authorized key files
.ssh/authorized_keys and .ssh/authorized_keys2. The supplied ED25519 server key
matches SHA256:cLDo0RcYLc5/iY5CmgRPoovjnxGEoRtcz+uqkI22LTo locally.
This is host identity evidence; it is not a dedicated CI client key or proof of
its authorization. Workflow/helper preparation is documented in
AUTOMATED_DEPLOYMENT.md. Delivery remains gated off pending review, server helper
installation, restricted key provisioning and installed-helper recovery rehearsal.
No secret, SSH configuration or VPS file was changed by this implementation.


## Status update: restricted SSH delivery and Actions enablement

Owner supplied successful real deployment of c82401205a06f7d48a679156e8a6925d924dadf8
through the installed restricted SSH helper, confirmed post-deployment checks and
verified all five backup manifest entries after transfer off-VPS. Helpers are
root-owned 755; dedicated SSH authorization, invalid-command rejection, locking
and DB dump permissions were checked. Isolated lifecycle recovery passed with
mocked deployment callbacks and real private PM2; complete production rollback
was not exercised. Owner reports the production environment/key secret configured
and PRODUCTION_DEPLOY_ENABLED=true. First end-to-end GitHub Actions delivery is
pending the next master merge, which will restart production even for docs-only
changes. See AUTOMATED_DEPLOYMENT.md for exact evidence and remaining limitations.
This update supersedes earlier pending bootstrap/transfer/enablement notes.
