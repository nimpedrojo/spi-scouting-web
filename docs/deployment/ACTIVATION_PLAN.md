# First production activation and rollback plan

Status: reviewable plan and PM2 declaration only. No activation commands have
been executed. Do not apply the ecosystem file to a rehearsal directory or run
this plan as an unattended script. Automated GitHub delivery is later work.

## Confirmed operating contract

| Item | Value |
| --- | --- |
| App identity | soccer-report, one fork process, ubuntu, PM2 6.0.14 |
| PM2 home / interpreter | /home/ubuntu/.pm2 / /usr/bin/node (22.23.3) |
| Current checkout | /var/www/spi-scouting-web |
| Backend / public URL | 127.0.0.1:3002 / https://soccer-report.processiq.es |
| Prepared deployment root | /var/www/spi-scouting-deploy (750), releases (750), shared (700), ubuntu-owned |
| Existing application log | /var/www/soccer_report/shared/logs/app.log |
| Current report template | /var/www/spi-scouting-web/src/templates/report_template.xlsm |
| PM2 output/error logs | /home/ubuntu/.pm2/logs/soccer-report-out.log and soccer-report-error.log |

The owner confirmed no PM2 LOG_FILE_PATH or REPORT_TEMPLATE_PATH override. The
template path above is the code fallback, not proof that an explicit .env value
exists. Preserve the production template bytes regardless of source defaults.

## Proposed shared state and release paths

These are planned destinations, not yet copied/created state:

```text
/var/www/spi-scouting-deploy/
  releases/<full-commit-SHA>/
    .env -> ../../shared/.env
    src/public/uploads -> ../../../../shared/uploads
  shared/
    .env
    uploads/
    templates/report_template.xlsm
  current -> releases/<full-commit-SHA>
```

Verify symlink resolution with realpath before any startup; prefer absolute
targets during initial preparation to avoid relative-link mistakes. current is
a release pointer, not PM2's CWD. The declaration uses explicit selected release
paths so PM2 cannot silently keep executing an old resolved current target.
Require a real SHA directory (not a symlink), verified checkout and shipped
ecosystem.config.cjs. The existing rehearsal checkout is not a production release.

Keep the existing absolute application log destination. This avoids an unrelated
log migration. Owner verified ubuntu-owned logs directory 775, app.log 664 and
ubuntu write access; rotation and any broader access policy still need review.
The existing report template is root-owned 644 and readable for the planned copy.
The shared template copy is intentional and must exist before applying the
declaration. The code shipped in Git must not overwrite shared files.

The production .env is copied privately, preserving existing DB credentials,
SESSION_SECRET and any encryption key/source continuity. Keep root:ubuntu 640
and verify ubuntu read access; use restrictive temporary creation and atomic
replacement. The shared parent is ubuntu-owned 700, so it is a trusted writable
deployment boundary, not protection against the ubuntu account itself.
Never copy the rehearsal .env, new test credentials or its database name into
production. Copy uploads including tracked and untracked files; preserve URLs.
Do not move or delete the original checkout or original uploads during first
preparation. Original and shared copies diverge after cutover: see rollback.

## Prerequisites still required before activation

- Review/merge this configuration and select the final full commit SHA; prepare
  a new release with npm ci --omit=dev under Node 22.23.3 / npm 10.9.9.
- Confirm scoped business flows needed by the owner and continuity of the stored
  ProcessIQ credential. Do not introduce an encryption key blindly. The loopback
  rehearsal's external import endpoint was deliberately disabled.
- Check log destination permissions/rotation; copy and compare the production
  report template into shared/templates. Template bytes should match before use.
- Verify production .env and relevant inherited PM2 settings privately. The
  inspected daemon has no DB/secret overrides, but recheck before cutover. Do not
  print secrets or persist raw environment snapshots in GitHub.
- Capture a private target-only PM2 rollback declaration with original CWD,
  script, interpreter, logs and required nonsecret settings. Preserve the old
  .env and code. A raw PM2 dump includes all applications and can contain secrets;
  it is not a target-only rollback operation.
- Rehearse target replacement and rollback using a disposable PM2 home/process
  and unused loopback port before using the production daemon. Unit tests of the
  configuration do not prove PM2 runtime behavior. Never bind a trial to 3002.
- Validate expected schema/DDL compatibility for the exact release and original
  rollback version. The successful startup rehearsal is evidence, not a schema
  diff or an automatic reversible database migration.
- Obtain a fresh coordinated DB/files/config backup immediately before the
  activation window. The earlier verified snapshot is not a current backup.

## Supervised activation sequence (not executable automation)

1. Agree a short write pause and session-loss window; serialize this app's
   release work with an app-specific lock. Prevent concurrent deploy/cleanup.
2. Stop only soccer-report through the existing ubuntu daemon. No daemon kill,
   systemctl restart/reload, PM2 resurrect or reload/restart all.
3. Take/verify the fresh backup and final synchronization of production uploads,
   .env and template to shared. If other processes write this schema/files, include
   them in the consistency policy; stopping this app alone is not sufficient.
4. Verify candidate links, immutable SHA identity, script paths and permissions.
   Do not import the app as a preflight against production: it initializes SQL.
5. Replace only the soccer-report PM2 entry with the reviewed declaration and
   SPI_RELEASE_PATH pointing at the exact SHA directory. A scoped delete/start
   strategy gives explicit script/CWD selection; secure prior metadata and prove
   its rollback first. Merely restarting by name or changing current is inadequate.
6. Startup initializes production schema/data. Inspect initialization errors,
   including logged ALTER errors, and run read-only schema postconditions.
7. Verify the actual process CWD, executable, script and loopback socket; health
   must be 200 with the expected body. The public login and an authenticated
   scoped flow must pass, and uploads/template export must work. Use bounded
   probes; PM2 online alone is not success. Define a finite verification deadline.
8. Atomically replace current via a temporary sibling symlink plus same-filesystem
   rename after successful verification. Keep original/previous release identity
   for rollback. If activation fails, restore the previous pointer as applicable.
9. Check all other app identities/statuses against the pre-change inventory.
   Reboot persistence requires a reviewed PM2 save under the correct owner/home;
   it serializes the entire daemon's process list, not just this app. Do it only
   after confirming unrelated apps and their intended saved state. Restore 600
   on dump.pm2 and dump.pm2.bak after save and check boot configuration.
10. End the write pause only after verification. Record SHA and results privately;
    retain previous code and backups. Do not prune releases/shared data now.

## Rollback boundaries

Before opening writes, a failed candidate may be stopped and only its target PM2
entry replaced with the privately captured original declaration, provided schema
changes remain compatible. Restore/verify original paths, port, HTTP response
and pointer. Do not resurrect the multi-application PM2 dump to roll back one app.

After writes resume, do not run the old app against its stale uploads tree. It
must use the same authoritative shared uploads (with path/permission behavior
verified), or perform a coordinated reverse synchronization with writes paused.
Test this before claiming instant rollback. Do not roll shared data back to the
old snapshot just to reverse a code release: it would discard new writes.

If SQL changes are incompatible or data is damaged, code rollback alone is not
sufficient. Stop writes and use a separately reviewed recovery procedure; never
automatically restore the database. Reboot recovery and full browser/Excel
visual checks remain distinct from a healthcheck.

## Current deliverable validation

Configuration tests reject absent, relative, current-symlink-style, rehearsal,
other-app and parent-traversal selections. They assert a single target app with
explicit interpreter/CWD/script, production listener and no embedded DB/session
secrets. No PM2 command is run by these tests. See DEPLOYMENT_AUDIT.md for owner
evidence and outstanding operational prerequisites.

Local validation: Node 22.23.3, nine suites / 202 tests passed against the
dedicated local MySQL schema; syntax and whitespace checks passed. Actual PM2
replacement/rollback rehearsal has not yet been run.

## Subsequent isolated PM2 rehearsal evidence

The owner completed an auxiliary HTTP A-to-B-to-A scoped delete/start trial with
explicit script/CWD/interpreter in /home/ubuntu/spi-pm2-trial-gNxOqAXN/pm2.
Expected release JSON and HTTP 200 were observed for both activation and rollback.
After the isolated daemon shutdown instruction, port 3102 was vacant and public
production login remained 200. This supersedes the earlier statement that no PM2
replacement trial has run, within this narrow auxiliary-process scope only.
The actual production ecosystem/app, shared files, DB compatibility and reboot
persistence were not exercised by that trial. No production activation occurred.

## First production activation result

Owner authorized/executed first activation of aeff9a1. Script HTTP/process checks
passed, original and new upload paths share authoritative storage, current was
updated, and other daemon application identities/statuses were unchanged. Fresh
verified backup is /home/ubuntu/spi-preactivation-CbJkbuGH. Post-activation login /
business checks, initialization logs and reviewed PM2 persistence remain pending.
No pm2 save, reboot test or automated deployment has been performed by this step.
See the audit update for detailed evidence and limitations.

## Post-activation verification and persistence

Owner confirmed the requested browser checks correct. The guarded other-app
comparison subsequently passed, the pre-save dumps were backed up privately and
pm2 save completed. Sanitized saved state contains the aeff9a1 target release and
all four expected applications. No reboot was performed. Transfer the fresh
preactivation backup/recovery files off-VPS and verify their manifest; automatic
GitHub-to-VPS delivery remains unimplemented.
