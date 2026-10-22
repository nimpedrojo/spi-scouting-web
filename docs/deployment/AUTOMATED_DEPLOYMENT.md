# Automated production delivery

Owner reports VPS bootstrap and the first real restricted-SSH deployment complete.
Production is on c82401205a06f7d48a679156e8a6925d924dadf8. The production
environment/key secret are configured, and the owner reports setting repository
variable PRODUCTION_DEPLOY_ENABLED=true. The first complete GitHub Actions
CI-to-VPS run remains pending; merging this documentation PR will trigger it.

## Workflow

Pull requests targeting master run CI. A push to master reuses the same CI through
workflow_call; production delivery requires successful validation and repository
variable PRODUCTION_DEPLOY_ENABLED set to exactly true. Until then the deploy job
is skipped. Configure the production GitHub environment to allow only master.
Requiring an environment approval on every run would add a manual deployment gate.
Branch protections and review requirements must protect master and workflow changes.

CI uses Node 22.23.3, npm ci and all tests against disposable runner MySQL, without
production credentials. The deploy job uses only PROD_SSH_PRIVATE_KEY, preferably
an environment secret on production. Database/session secrets stay on the VPS.
No checkout credentials persist. Actions are pinned. The SSH client uses ubuntu,
51.75.255.4, port 22 and strict verification against production_known_hosts.
The owner-supplied ED25519 key locally verifies as:

    SHA256:cLDo0RcYLc5/iY5CmgRPoovjnxGEoRtcz+uqkI22LTo

The public host key is not a client authorization key. Compare its fingerprint
through a trusted VPS console before enabling; never accept a replacement key
without independent verification. Owner reports public-key authentication enabled,
root login disabled and password authentication enabled. This change does not
alter sshd or the existing interactive login method.

## Server control plane

After review, install scripts/deploy-ssh-command.sh as
/usr/local/libexec/spi-scouting-deploy and scripts/deploy-production.cjs as
/usr/local/libexec/spi-scouting-deploy.cjs, both root-owned, mode 755. Parent
/usr/local/libexec must also be root-owned and not writable by ubuntu. Keep these
reviewed helpers separate from incoming release source; future helper changes
require a deliberate installation. Owner confirmed both helpers installed and byte-compared with the reviewed source,
with root:root ownership and mode 755 (parent directory also root:root 755).

Generate a dedicated unencrypted ED25519 client key for CI; never reuse a personal
key or send the private key in chat. Store its private part directly in the GitHub
secret. The corresponding public key needs one ubuntu authorized_keys entry:

    restrict,command="/usr/local/libexec/spi-scouting-deploy" ssh-ed25519 <dedicated public key>

The placeholder must be replaced locally, not installed literally. Preserve existing
keys and verify ownership/modes of .ssh and authorized_keys. Test from a second
connection before changing existing access. The forced command accepts only
`deploy <40 lowercase hex commit SHA>`, disables forwarding/PTY through restrict,
clears inherited environment and obtains a nonblocking flock before starting Node.
Required binaries are /usr/bin/node, npm, pm2, git, flock, mariadb-dump, tar, gzip,
sha256sum and curl. Confirm these exact locations and versions on the VPS first.

This restriction limits the SSH command surface, not the Linux privileges of
ubuntu. Application code and npm lifecycle scripts still run as ubuntu, which
owns the other PM2 applications. Repository writers are trusted server-code
operators. Root ownership of the helper is not isolation from malicious application
code. Never run this helper as root or restart the shared PM2 systemd service.

## Activation and recovery

The helper requires the existing deployment root, shared files and current SHA
symlink from manual activation. It checks Node 22.23.3/npm 10.9.9, the existing
ubuntu PM2 daemon and current process identity. It rejects stale requested SHAs
against remote master, prepares a fresh SHA directory with npm ci --omit=dev,
and links shared environment/uploads. The PM2 declaration must retain the reviewed
host, port, template, log, process name and environment contract.

Changes to database initialization, SQL or model directories are conservatively
blocked before stopping production, including ordinary model edits. Such releases
need separate review; the guard is not complete SQL-change detection because
arbitrary application JavaScript can access the database. Existing startup
initialization still executes. It is not a transactional migration system.

After a second master check, only soccer-report stops. A private backup under
/var/www/spi-scouting-deploy/backups contains SQL, previous source plus actual shared
state, pre-save PM2 dumps and release metadata, with a verified checksum manifest.
The current DB user must have dump privileges including routines/events/triggers;
verify this using a separate backup rehearsal before enabling. The stopped app
must be the sole business-data writer during the backup window. This does not
coordinate external writers or unrelated applications sharing the same schema.

The helper explicitly deletes/starts only soccer-report using the immutable SHA
path. It requires local/public health JSON and HTTP 200, public login HTTP 200,
correct process CWD/script and unchanged unrelated application PID/status. It then
atomically advances current, saves PM2, restricts dump permissions and rechecks.
There is a short outage while backup and activation run; sessions in MemoryStore
are lost on restart. No zero-downtime guarantee is made.

Failures after stop attempt recovery to the previous release and restore its
saved PM2 dumps/current pointer. SQL is never automatically restored over business
writes. Rollback failure remains a failed workflow requiring operator recovery.
A twelve-minute operation deadline aborts normal commands; recovery uses separate
commands. SSH disconnection does not intentionally cancel recovery. Power loss,
forced termination and host failure still require operator intervention.

A retry of the already-current SHA verifies health and saved identity without
restarting. Existing noncurrent SHA directories are never overwritten: inspect
failed preparations and the live pointer before deciding how to retry. There is
no automatic release deletion. GitHub concurrency prevents cancellation of a
running deployment; intermediate pending pushes can be superseded. The server
also rejects commits overtaken by master; the workflow delivers the latest
eligible revision rather than promising to activate every intermediate merge.

## Enablement procedure (bootstrap completed; Actions validation pending)

1. Review/merge the workflow, helper and tests with the enable variable absent.
2. Confirm binary paths, shared state, PM2 persistence, dump privileges and disk
   capacity. Verify the host fingerprint through a trusted console.
3. Install the reviewed root-owned helpers and dedicated restricted client key.
   Test invalid-command rejection and lock contention without stopping production.
4. Rehearse the installed helper and failure recovery in isolation. Unit tests do
   not establish a real MariaDB/PM2/SSH recovery test. Preserve an operator session
   and current private recovery copies for the first real automatic delivery.
5. Configure the production environment, private-key secret and master protections.
   Set repository variable PRODUCTION_DEPLOY_ENABLED=true only when ready.
6. Observe the next master delivery, including health, login, other applications
   and saved PM2 state; download/verify the new private backup off-host.

Recurring off-host backups, encrypted backup storage and retention are not
implemented by this workflow. Establish those policies and monitor disk growth;
a local per-deploy snapshot alone does not protect against VPS loss. A real
reboot/resurrection test remains unperformed. Disable the repository variable to
prevent subsequent delivery, without cancelling an activation already running.

## Local validation

All 231 tests in 10 suites passed on Node 22.23.3 with the dedicated local MySQL
schema, including 29 deployment contract/recovery tests. Shell/Node syntax,
workflow YAML parsing, host-key fingerprint and whitespace checks passed.
No VPS, SSH authorization, live PM2 replacement or automatic rollback was exercised.


## Operational evidence through 2026-10-22

The following are owner-supplied command results, not direct agent access to the VPS:

- Binary paths/runtime, available disk space and the pinned ED25519 host fingerprint
  were verified. Invalid SSH commands were rejected through the dedicated client
  key, and lock contention was rejected without entering deployment logic.
- The production DB account successfully executed the helper-equivalent dump
  options. The private check copy remains at
  /home/ubuntu/spi-dump-check-T7YsLm6U/database.sql.
- An isolated PM2 rehearsal used executeDeployment from the installed helper:
  deliberate release-B startup failure was detected and release A recovered.
  Callbacks used dummy applications; this did not exercise ProductionDeployment's
  complete rollback, SQL backup or saved-state recovery. The private rehearsal
  daemon was subsequently stopped by the owner.
- A real restricted-SSH deployment of c824012 completed with backup, health checks
  and PM2 persistence. Initial localhost connection refusals were retried during
  startup; the helper reported successful deployment. Owner confirmed subsequent
  technical and browser checks, without supplying their full individual output.
- Backup directory:
  /var/www/spi-scouting-deploy/backups/2026-10-21T15-34-25-145Z-c82401205a06-aN4LmA.
  Mac transfer verified all five manifest entries: application-files.tar.gz,
  database.sql, dump.pm2, dump.pm2.bak and release.json. This snapshot precedes
  activation and does not contain subsequent business writes.

The next master merge is an intentional first GitHub Actions delivery, with a
production restart and session loss even for documentation-only changes. Review
both validate and deploy jobs, confirm the deployed merge SHA/current pointer,
health/login and other applications, and transfer/verify that run's backup.
If deployment fails, inspect the run and production recovery before retrying.
No full live rollback, reboot test, automatic off-host copying or retention policy
has been established by these checks. Earlier preparation-only statements in the
audit/activation history describe their respective stages.
