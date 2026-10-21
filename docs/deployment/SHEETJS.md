# SheetJS dependency and security maintenance

The application uses SheetJS CE 0.20.3 through the official versioned artifact:

https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz

The URL is fixed in package.json; package-lock.json records its SHA-512 integrity.
Use npm ci to install the same artifact. The CommonJS module remains `xlsx`, so
imports, evaluation exports and the macro-enabled report route retain their APIs.
No application logic or template is changed by this dependency update.

The npm registry distribution stops at 0.18.5. The official upstream release
exceeds the fixed-version thresholds for CVE-2023-30533 (0.19.3) and
CVE-2024-22363 (0.20.2). This addresses those known findings rather than hiding
them with audit exclusions or changing the dependency's name.

- [Official Node installation instructions](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)
- [Prototype pollution advisory](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)
- [ReDoS advisory](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)

On top of the compatible dependency fixes in PR #20, npm audit --omit=dev reports
zero findings. npm audit does not provide complete coverage of external tarball
sources: review upstream advisories and release provenance when upgrading, even
if this command succeeds. Zero reported findings is not proof of zero security
risk. Existing deprecation warnings (including multer) require separate review.

Installation requires HTTPS access to both the npm registry and cdn.sheetjs.com.
An unavailable CDN or changed artifact will fail a cold npm ci installation;
the lockfile integrity protects against silently accepting different bytes.
Upstream also documents vendoring as an option for infrastructure independence.
This change uses the pinned HTTPS URL to keep the repository free of a bundled
third-party binary archive; no CDN fallback or unpinned mirror is configured.

Validation: clean npm ci with Node 22.23.3 / npm 10.9.9 and eight suites / 195
tests passed against an isolated local MySQL database. Existing tests cover workbook
imports and evaluation/player-load exports. A new integration test exercises
the actual report XLSM download with the shipped template, checks populated
player fields, compares the complete VBA bytes and sheet names, and verifies
formulas and merged-cell ranges survive the round trip. It does not execute VBA
or certify exact visual fidelity in Microsoft Excel; a visual report check is
still appropriate during release rehearsal.

This branch is based on dependency-security-fixes (PR #20). Merge #20 first,
then confirm the reduced diff and rerun CI against master. This PR targets
master so the existing CI runs; until #20 merges, it includes that prerequisite
commit in its history.
The existing VPS rehearsal directory still has the previous package/lock files;
do not update it in place. Prepare a new exact-commit candidate after review.
No deployment, schema change, production credential or VPS modification is part
of this change.
