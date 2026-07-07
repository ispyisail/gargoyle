#ifndef APKEXEC_H
#define APKEXEC_H

/*
 * apkexec.c is the ONLY place in gpkg that ever invokes the apk binary
 * (see docs/gapk-implementation-plan.md Phase 2 in the gargoyle-tools
 * repo). It wraps each apk subcommand gpkg needs behind a small,
 * gpkg-shaped API -- callers never see apk's argv, stdout/stderr, or
 * exit-code quirks directly.
 *
 * The apk binary path is read from the GPKG_APK_BIN environment
 * variable (default "/usr/bin/apk") so host tests can point it at a
 * locally-built apk-tools binary instead of a real target's /usr/bin/apk.
 *
 * IMPORTANT for every function below that takes a keysdir: apk resolves
 * --keys-dir via openat(root_fd, keys_dir, ...) -- i.e. RELATIVE to
 * whatever --root was also passed, not to cwd. A relative keysdir
 * silently resolves to "<root>/<keysdir>" (usually nonexistent) and
 * fails with a confusing "UNTRUSTED signature" error that looks like a
 * signing problem but isn't (verified live against apk-tools 3.0.5).
 * Every keysdir argument passed into this module MUST be an absolute
 * path; callers are responsible for that, apkexec.c does not normalize
 * it for them.
 *
 * Every function here returns a "not found" / failure indication
 * (NULL or 0) on any problem and writes a one-line diagnostic to
 * stderr -- callers don't need to inspect apk_result themselves except
 * via apk_run() directly.
 */

#include <erics_tools.h>
#include "json.h"

/* Result of a single apk invocation: stdout/stderr captured separately
 * (never NULL -- empty string if the stream produced no output),
 * exit_code is the process's real exit status, or -1 if apk could not
 * be exec'd at all or was killed by a signal. */
typedef struct
{
	char* out;
	char* err;
	int exit_code;
} apk_result;

/* Runs argv[0] (the apk binary path itself, typically apk_bin_path())
 * followed by its arguments, NULL-terminated -- mirrors xsystem.c's
 * argv-vector style (no shell involved). Captures stdout and stderr
 * separately via a fork+pipe+poll() pattern so neither stream can fill
 * its pipe buffer and deadlock the child. Returns NULL only if the
 * fork/pipe machinery itself failed (see stderr for detail); a failed
 * apk invocation still returns a non-NULL apk_result with exit_code
 * set accordingly. Caller owns the result and must free it with
 * apk_result_free(). */
apk_result* apk_run(const char* argv[]);
void apk_result_free(apk_result* r);

/* The GPKG_APK_BIN-resolved apk binary path (default "/usr/bin/apk"). */
const char* apk_bin_path(void);

/* `apk query --root <root> [--keys-dir <keysdir>] [--repository <repo>]
 * [--recursive] --format json --fields <fields> <pkg>`. repo/keysdir may
 * be NULL to omit those flags (root-only query, e.g. installed-package
 * lookups with no repo context). fields is a single comma-joined string
 * exactly as apk expects it (e.g. "name,version,depends,status"). An
 * empty/no-match result is NOT an error -- apk exits 0 with an empty
 * JSON array on stdout even when nothing matches; the returned
 * json_value* reflects that (a JSON_ARRAY of length 0), not NULL.
 * Returns NULL only on a real invocation failure (apk_run() itself
 * failed, or the output could not be parsed as JSON at all). Caller
 * owns the result and must free it with json_free(). */
json_value* apk_query_json(const char* root, const char* repo, const char* keysdir,
	int recursive, const char* fields, const char* pkg);

/* `apk fetch --root <root> [--keys-dir <keysdir>] [--repository <repo>]
 * --output <outdir> <pkg>`. pkg MUST be a bare package name -- version-
 * pin syntax ("pkg=1.0-r0", "pkg~1.0-r0", etc.) reliably fails apk's
 * fetch package-spec parser even though it is valid apk-world(5) syntax
 * for `add`/`del` (validated live against apk-tools 3.0.5; not
 * documented anywhere as a fetch-specific limitation). apk's own
 * stdout/stderr usage for fetch is inconsistent between a fresh
 * download (progress line on stdout) and an idempotent re-fetch of an
 * already-cached file (nothing on stdout, bare filename on stderr) --
 * this function does NOT parse either stream. Instead, on exit_code 0,
 * it globs outdir for a "<pkg>-*" match (with a dash-boundary check so
 * "bar" cannot match "barbaz-1.0.apk") to locate the fetched file,
 * which is deterministic and stream-format-independent either way.
 * Returns a newly-malloc'd full path to the fetched file, or NULL on
 * failure (apk_run() failure, non-zero exit, or no matching file found
 * post-fetch). Caller owns the returned string and must free() it. */
char* apk_fetch(const char* root, const char* repo, const char* keysdir,
	const char* outdir, const char* pkg);

/* `apk manifest --root <root> [--keys-dir <keysdir>] <file>` -- returns
 * a string_map of path -> "sha256:<hex>" (the pre-commit file list gpkg
 * needs before it ever extracts anything, for its own conflict-check/
 * files_to_link precompute). Despite needing no db to *read*, manifest
 * still enforces <file>'s package signature exactly like add/extract --
 * a signed package fails with "UNTRUSTED signature" unless keysdir (an
 * ABSOLUTE path -- see the module-level note above) names a directory
 * containing the trusted pubkey; keysdir may be NULL only for an
 * unsigned file or a root whose own /etc/apk/keys already has the
 * right key (this was NOT in the plan's original two-arg sketch --
 * found live while building this module's own tests: apk_add_mainroot's
 * --keys-dir does not get copied into <root>/etc/apk/keys, so every
 * later manifest/extract call against packages signed the same way
 * needs its own explicit keysdir again). apk manifest returns exit code
 * 0 even when <file> doesn't exist, printing "ERROR: <path>: ..." to
 * stdout instead of a real failure signal -- this function does NOT
 * trust exit_code alone; any output that isn't a well-formed run of
 * "sha256:<hex>  <path>" lines (including the ERROR case, or an
 * UNTRUSTED-signature rejection) is treated as failure. Returns NULL on
 * failure. Caller owns the returned string_map (keys and values both
 * heap-owned) and must destroy_string_map() it. */
string_map* apk_manifest(const char* root, const char* keysdir, const char* file);

/* `apk extract [--keys-dir <keysdir>] --destination <destdir>
 * [--allow-untrusted] <file>` -- db-less, script-less, dependency-blind
 * placement of a single package's files into destdir (this is what
 * places files into a non-main gpkg dest, e.g. plugin_root). keysdir
 * may be NULL only if allow_untrusted is set. Returns 1 on success, 0
 * on failure. */
int apk_extract(const char* keysdir, const char* destdir, const char* file, int allow_untrusted);

/* `apk add --root <root> [--keys-dir <keysdir>] [--repository <repo>]
 * [--arch <arch>] [--initdb] [--usermode] <pkg>` -- full apk-native
 * install into a root apk itself owns (the main root only; non-main
 * dests always go through apk_fetch+apk_manifest+apk_extract instead).
 * initdb should be non-zero only the first time a given root is ever
 * touched by apk (creates /etc/apk/... under root); passing it again on
 * an already-initialized root is harmless (validated live) but is not
 * this function's job to infer -- caller decides. Returns 1 on success,
 * 0 on failure. */
int apk_add_mainroot(const char* root, const char* repo, const char* keysdir,
	const char* arch, int initdb, int usermode, const char* pkg);

/* `apk del --root <root> <pkg>` -- removes pkg from the main root's own
 * apk-managed db, auto-purging any now-orphaned dependencies (apk's own
 * behavior, not something gpkg drives). Returns 1 on success, 0 on
 * failure. */
int apk_del_mainroot(const char* root, const char* pkg);

/* `apk adbdump --format json <file>` -- dumps a package's ADB metadata,
 * including its embedded pre-install/post-install SCRIPT TEXT (under
 * the "scripts" object, keyed "pre-install"/"post-install") -- this is
 * how gpkg gets script content out of a .apk file for a non-main dest
 * install, since `apk extract` deliberately never places or runs
 * scripts (found live while building Phase 4: apk_extract's own
 * destination tree never contains them, matching its own description,
 * "extracted without checking dependencies or other metadata"). Needs
 * NO db/root/keys-dir context at all and does not enforce the file's
 * signature (confirmed live: succeeds silently, exit 0, on an
 * untrusted-signature package -- adbdump is a pure metadata read, not
 * a trust-gated operation like manifest/extract/add). Returns NULL on
 * failure (apk_run() failure or unparseable output). Caller owns the
 * result and must json_free() it. */
json_value* apk_adbdump_json(const char* file);

#endif
