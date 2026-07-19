#!/bin/sh
# ota_upgrade.sh -- RFC #62 signed OTA firmware upgrade: check / download /
# verify subcommands (build phase C1; `apply` lands in phase C2). Invoked
# directly (via the /usr/sbin/ota_upgrade wrapper) for CLI/cron use, and
# later by a CGI wrapper for the System > Update GUI page (phase C4) and the
# opt-in autocheck cron job (phase C5).
#
# Trust root: the usign keys directory gpkg ALREADY verifies the plugin feed
# against (baked in by package/gpkg since PR #101, default
# /etc/opkg/keys/<fingerprint>). One trust root for feeds and OTA, not two --
# this deliberately diverges from the RFC's original /etc/gargoyle/ota.pub
# text, which predates the plugin-feed signing work landing first.
#
# Manifest source: https://ispyisail.github.io/gargoyle-firmware/ota/
# manifest-<channel>.json (+ .sig), produced by gargoyle-firmware's
# make-manifest.sh / sign-manifests.yml. Schema (see gargoyle-firmware's
# devices/README.md and scripts/make-manifest.sh):
#   { "schema": 1, "channel": "...", "generated": "<ISO-8601 UTC>",
#     "devices": { "<board_name>": { "version", "date", "url", "sig_url",
#       "sha256", "size", "min_ram_kb", "min_flash_kb", "eol",
#       "final_version", "note", "changelog" } } }
#
# Env overrides exist ONLY to make this script host-testable without a
# router (no ubus/uci/jsonfilter there); they double as the vnet phase 42
# test hooks -- x86 has no manifest entry of its own, so the test mocks one
# keyed to whatever board_name it chooses via OTA_BOARD_NAME.
#   OTA_BOARD_NAME     substitutes for `ubus call system board`
#   OTA_CHANNEL        substitutes for `uci get gargoyle.ota.channel`
#   OTA_MANIFEST_BASE  substitutes for `uci get gargoyle.ota.manifest_base`
#   OTA_KEYS_DIR       substitutes for the usign keys directory
#   OTA_STATE_DIR      substitutes UCI-backed state (gargoyle.ota.*) with a
#                      plain file under this dir -- see ota_state_get/_set
#   OTA_STATUS_FILE    substitutes for /tmp/ota_status
#   OTA_WORK_DIR       substitutes for /tmp/ota (download staging)
set -e

OFFICIAL_KEY_FPR="106823761d1f5bd4"
DEFAULT_MANIFEST_BASE="https://ispyisail.github.io/gargoyle-firmware/ota"

KEYS_DIR="${OTA_KEYS_DIR:-/etc/opkg/keys}"
STATUS_FILE="${OTA_STATUS_FILE:-/tmp/ota_status}"
WORK_DIR="${OTA_WORK_DIR:-/tmp/ota}"

# ─── status file (atomic, so a GUI/cron poller never reads a half-write) ────
ota_status() {
	# $1=state $2=detail (optional)
	mkdir -p "$(dirname "$STATUS_FILE")" 2>/dev/null
	{
		echo "state=$1"
		[ -n "$2" ] && echo "detail=$2"
		echo "updated=$(date +%s)"
	} > "${STATUS_FILE}.tmp"
	mv -f "${STATUS_FILE}.tmp" "$STATUS_FILE"
}

# ─── config readers ──────────────────────────────────────────────────────────

ota_board_name() {
	if [ -n "$OTA_BOARD_NAME" ]; then
		printf '%s' "$OTA_BOARD_NAME"
	else
		ubus call system board 2>/dev/null | jsonfilter -e '@.board_name' 2>/dev/null || true
	fi
}

ota_channel() {
	if [ -n "$OTA_CHANNEL" ]; then
		printf '%s' "$OTA_CHANNEL"
	else
		local _c
		_c="$(uci -q get gargoyle.ota.channel 2>/dev/null)" || true
		printf '%s' "${_c:-stable}"
	fi
}

ota_manifest_base() {
	if [ -n "$OTA_MANIFEST_BASE" ]; then
		printf '%s' "$OTA_MANIFEST_BASE"
	else
		local _m
		_m="$(uci -q get gargoyle.ota.manifest_base 2>/dev/null)" || true
		printf '%s' "${_m:-$DEFAULT_MANIFEST_BASE}"
	fi
}

# usign -V looks a key up by FILENAME == its own fingerprint (verified live
# against the baked /etc/opkg/keys/106823761d1f5bd4 -- a key saved as
# anything else is silently never found). Fail-closed: no matching key in
# $KEYS_DIR -> reject. Verifies $1 against the sibling $1.sig.
ota_verify_sig() {
	usign -V -q -m "$1" -x "$1.sig" -P "$KEYS_DIR" 2>/dev/null
}

# True (shell 0) if the official OTA/feed key is NOT present in the keys
# dir. Matches the RFC's anti-clobber rule: extra/other keys alongside the
# official one do not disable official OTA -- only the official key's own
# ABSENCE does (e.g. a self-built image that never got it baked in).
ota_is_custom_build() {
	[ ! -f "$KEYS_DIR/$OFFICIAL_KEY_FPR" ]
}

# Persisted OTA state (the anti-replay `generated` marker, and -- from
# phase C2 -- the last-applied image's sha256). On a real router this MUST
# survive a keep-settings sysupgrade, and a plain file under /etc/gargoyle/
# does NOT: OpenWrt's keep-settings sweep preserves /etc/config/* (via each
# package's registered conffiles) plus whatever /etc/sysupgrade.conf lists
# (empty by default) plus lib/upgrade/keep.d/* (essential system files only,
# e.g. /etc/passwd) -- an arbitrary directory like /etc/gargoyle/ is covered
# by NONE of those unless a package explicitly registers it. UCI options
# under /etc/config/gargoyle ARE reliably preserved, so that is the real
# persistence mechanism; OTA_STATE_DIR remains the host/vnet TEST substitute
# (plain file, no real UCI needed) -- exactly the role its sibling env
# overrides already play.
ota_state_get() {
	# $1 = key (last_generated | applied_sha256)
	if [ -n "$OTA_STATE_DIR" ]; then
		cat "$OTA_STATE_DIR/ota_$1" 2>/dev/null || true
	else
		uci -q get "gargoyle.ota.$1" 2>/dev/null || true
	fi
}

ota_state_set() {
	# $1 = key, $2 = value
	if [ -n "$OTA_STATE_DIR" ]; then
		mkdir -p "$OTA_STATE_DIR" 2>/dev/null
		printf '%s' "$2" > "$OTA_STATE_DIR/ota_$1"
	else
		# Defensive: a router on firmware that predates this file's default
		# /etc/config/gargoyle addition has no `ota` section yet, and
		# `uci set pkg.section.opt=val` fails outright when the section
		# itself does not exist (confirmed live) -- create it first.
		uci -q get gargoyle.ota >/dev/null 2>&1 || uci set gargoyle.ota=ota 2>/dev/null
		uci set "gargoyle.ota.$1=$2" 2>/dev/null
		uci commit gargoyle 2>/dev/null
	fi
	return 0
}

# download/verify re-emit the board/channel/version/etc. context from their
# internal `check` call, but must strip ITS `result=` line first -- otherwise
# stdout would carry two `result=` lines (check's answer, then download's/
# verify's own), and a caller has no clean way to tell which is authoritative.
ota_print_context() {
	# `|| true`: grep exits 1 if filtering leaves nothing to print (e.g. a
	# context consisting of exactly one result= line and nothing else) --
	# under `set -e` that would silently abort the caller. Printing zero
	# context lines is not an error, so this must never fail the caller.
	printf '%s\n' "$1" | grep -v '^result=' || true
}

# ─── check ────────────────────────────────────────────────────────────────
# Emits key=value lines on stdout. Exit 0 for every state that is a genuine,
# trustworthy answer (available/up-to-date/not-listed/eol/below-floor/
# custom-build) -- those are not failures, they are the check having done
# its job. Exit 1 only for a hard failure that produced no trustworthy
# answer at all (network, signature, replay).
cmd_check() {
	mkdir -p "$WORK_DIR"
	ota_status "checking"

	local _board _channel _base _manifest_url _manifest _sig
	_board="$(ota_board_name)"
	if [ -z "$_board" ]; then
		ota_status "failed" "could not determine board_name"
		echo "result=error"
		echo "error=no-board-name"
		return 1
	fi
	_channel="$(ota_channel)"
	_base="$(ota_manifest_base)"
	_manifest_url="${_base}/manifest-${_channel}.json"

	_manifest="$WORK_DIR/manifest.json"
	_sig="$WORK_DIR/manifest.json.sig"
	rm -f "$_manifest" "$_sig"

	if ! uclient-fetch -q -O "$_manifest" "$_manifest_url" 2>/dev/null || [ ! -s "$_manifest" ]; then
		ota_status "failed" "manifest download failed"
		echo "result=error"
		echo "error=download-failed"
		echo "url=$_manifest_url"
		return 1
	fi
	if ! uclient-fetch -q -O "$_sig" "${_manifest_url}.sig" 2>/dev/null || [ ! -s "$_sig" ]; then
		ota_status "failed" "manifest signature download failed"
		echo "result=error"
		echo "error=download-failed"
		echo "url=${_manifest_url}.sig"
		return 1
	fi

	if ! ota_verify_sig "$_manifest"; then
		ota_status "failed" "manifest signature verification failed"
		echo "result=error"
		echo "error=bad-signature"
		return 1
	fi

	# Anti-replay: flag (but don't hard-block) a validly-signed manifest
	# whose `generated` timestamp regressed versus the last one this router
	# saw. Compared as strings -- ISO-8601 UTC ("2026-07-18T05:43:41Z")
	# sorts lexically, no date parsing needed.
	#
	# A regression here is NOT proof of an attack: the manifest already
	# passed signature verification above, so it is genuinely from the
	# trusted publisher, not a forged/attacker-controlled file. A publisher
	# can legitimately revert a channel to an earlier snapshot (seen live:
	# the "stable" channel's generated timestamp went backward on
	# 2026-07-18 after a prior, newer publish). Hard-failing `check` itself
	# on this left a router permanently unable to see ANY future update --
	# including a genuinely newer one -- until a manifest newer than the
	# poisoned marker eventually appeared, since the marker was already
	# ratcheted forward by the earlier (since-reverted) check.
	#
	# So: check surfaces this as a warning and keeps going (still useful
	# information even from a regressed manifest), and does NOT move
	# last_generated backward (so a genuine rollback attack still can't
	# make the marker itself regress). The actual hard block moves to
	# cmd_download/cmd_verify below -- an attacker replaying an old,
	# validly-signed-in-the-past manifest to trigger a downgrade is a real
	# risk specifically at download/apply time, not at check time.
	local _generated _last _manifest_regressed
	_generated="$(jsonfilter -i "$_manifest" -e '@.generated' 2>/dev/null)" || true
	_last="$(ota_state_get last_generated)"
	_manifest_regressed=0
	if [ -n "$_last" ] && [ -n "$_generated" ] && \
	   [ "$(printf '%s\n%s\n' "$_generated" "$_last" | sort | tail -1)" != "$_generated" ]; then
		ota_status "warning" "manifest is older than the last one seen -- treating as informational only, download/apply will refuse to act on it"
		_manifest_regressed=1
	else
		[ -n "$_generated" ] && ota_state_set last_generated "$_generated"
	fi

	echo "board=$_board"
	echo "channel=$_channel"
	echo "manifest_regressed=$_manifest_regressed"
	echo "generated=$_generated"

	if ota_is_custom_build; then
		ota_status "custom-build"
		echo "result=custom-build"
		echo "note=official key not present in $KEYS_DIR -- official OTA disabled unless opted in"
		return 0
	fi

	local _entry
	_entry="$(jsonfilter -i "$_manifest" -e "@.devices[\"$_board\"]" 2>/dev/null)" || true
	if [ -z "$_entry" ] || [ "$_entry" = "null" ]; then
		ota_status "not-listed"
		echo "result=not-listed"
		return 0
	fi

	local _eol
	_eol="$(printf '%s' "$_entry" | jsonfilter -e '@.eol' 2>/dev/null)" || true
	if [ "$_eol" = "true" ]; then
		local _final _note
		_final="$(printf '%s' "$_entry" | jsonfilter -e '@.final_version' 2>/dev/null)" || true
		_note="$(printf '%s' "$_entry" | jsonfilter -e '@.note' 2>/dev/null)" || true
		ota_status "eol"
		echo "result=eol"
		echo "final_version=$_final"
		echo "note=$_note"
		return 0
	fi

	# Hardware floors: min_ram_kb is compared against THIS unit's real
	# MemTotal (defends against batch variance -- the manifest's floor was
	# measured on one reference unit, see devices/README.md). min_flash_kb
	# has no portable, generic "free space" probe across NAND/NOR/eMMC in
	# v1, so it is checked the other, still-meaningful way: the OFFERED
	# image's own size must not exceed the known-good partition floor for
	# this board. (Both are static, pre-measured facts about this exact
	# board_name -- not a live storage scan.)
	local _min_ram _min_flash _size _mem_total
	_min_ram="$(printf '%s' "$_entry" | jsonfilter -e '@.min_ram_kb' 2>/dev/null)" || true
	_min_flash="$(printf '%s' "$_entry" | jsonfilter -e '@.min_flash_kb' 2>/dev/null)" || true
	_size="$(printf '%s' "$_entry" | jsonfilter -e '@.size' 2>/dev/null)" || true
	_mem_total="$(awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null)"
	if { [ -n "$_min_ram" ] && [ -n "$_mem_total" ] && [ "$_mem_total" -lt "$_min_ram" ]; } || \
	   { [ -n "$_min_flash" ] && [ -n "$_size" ] && [ "$_size" -gt $((_min_flash * 1024)) ]; }; then
		ota_status "below-floor"
		echo "result=below-floor"
		echo "min_ram_kb=$_min_ram"
		echo "mem_total_kb=$_mem_total"
		echo "min_flash_kb=$_min_flash"
		echo "image_size=$_size"
		return 0
	fi

	# "Up to date" means "matches the last image THIS script applied", read
	# from a marker apply (phase C2) writes -- not "matches whatever is
	# currently running", which would require reconciling the manifest's
	# release-tag version scheme against gargoyle.global.version's internal
	# "1.15.X (Built ...)" string; those are not directly comparable. A
	# router that was manually flashed to exactly this build (no marker
	# yet) is therefore offered the update anyway -- reapplying it is a
	# harmless no-op (same sha256), not a wrong answer, just an extra click.
	local _version _sha256 _url _sig_url _changelog _applied
	_version="$(printf '%s' "$_entry" | jsonfilter -e '@.version' 2>/dev/null)" || true
	_sha256="$(printf '%s' "$_entry" | jsonfilter -e '@.sha256' 2>/dev/null)" || true
	_url="$(printf '%s' "$_entry" | jsonfilter -e '@.url' 2>/dev/null)" || true
	_sig_url="$(printf '%s' "$_entry" | jsonfilter -e '@.sig_url' 2>/dev/null)" || true
	_changelog="$(printf '%s' "$_entry" | jsonfilter -e '@.changelog' 2>/dev/null)" || true
	_applied="$(ota_state_get applied_sha256)"

	if [ -n "$_sha256" ] && [ "$_sha256" = "$_applied" ]; then
		ota_status "up-to-date"
		echo "result=up-to-date"
		echo "version=$_version"
		return 0
	fi

	ota_status "available"
	echo "result=update-available"
	echo "version=$_version"
	echo "sha256=$_sha256"
	echo "url=$_url"
	echo "sig_url=$_sig_url"
	echo "size=$_size"
	echo "changelog=$_changelog"
	return 0
}

# ─── download ─────────────────────────────────────────────────────────────
# Re-derives the offer from a fresh `check` rather than trusting any
# caller-supplied url/sha256, so download can never be pointed at an
# arbitrary file by a compromised caller.
cmd_download() {
	mkdir -p "$WORK_DIR"
	local _check_out _result _regressed _url _sig_url _sha256 _size
	_check_out="$(cmd_check)" || { ota_print_context "$_check_out"; return 1; }
	_result="$(printf '%s\n' "$_check_out" | sed -n 's/^result=//p')"
	if [ "$_result" != "update-available" ]; then
		ota_print_context "$_check_out"
		echo "error=no-update-available"
		return 1
	fi
	# check surfaces a manifest-regression as a warning rather than
	# hard-failing (see the anti-replay comment in cmd_check), but
	# download/apply is where a rollback attack would actually do damage,
	# so the hard block belongs here instead.
	_regressed="$(printf '%s\n' "$_check_out" | sed -n 's/^manifest_regressed=//p')"
	if [ "$_regressed" = "1" ]; then
		ota_status "failed" "refusing to download: manifest is older than one previously seen by this router"
		ota_print_context "$_check_out"
		echo "error=stale-manifest"
		return 1
	fi
	_url="$(printf '%s\n' "$_check_out" | sed -n 's/^url=//p')"
	_sig_url="$(printf '%s\n' "$_check_out" | sed -n 's/^sig_url=//p')"
	_sha256="$(printf '%s\n' "$_check_out" | sed -n 's/^sha256=//p')"
	_size="$(printf '%s\n' "$_check_out" | sed -n 's/^size=//p')"

	# Free-RAM pre-flight BEFORE downloading a single byte: the image is
	# staged in /tmp (tmpfs, RAM-backed), so available RAM -- not disk -- is
	# the real constraint. 24 MB headroom for the running system.
	local _mem_avail _need_kb
	_mem_avail="$(awk '/^MemAvailable:/{print $2}' /proc/meminfo 2>/dev/null)"
	_need_kb=$(( (_size / 1024) + 24576 ))
	if [ -n "$_mem_avail" ] && [ "$_mem_avail" -lt "$_need_kb" ]; then
		ota_status "failed" "not enough free RAM to stage the download"
		ota_print_context "$_check_out"
		echo "error=insufficient-ram"
		echo "mem_available_kb=$_mem_avail"
		echo "need_kb=$_need_kb"
		return 1
	fi

	ota_status "downloading"
	local _img="$WORK_DIR/ota.img"
	local _imgsig="$WORK_DIR/ota.img.sig"
	rm -f "$_img" "$_imgsig"
	if ! uclient-fetch -q -O "$_img" "$_url" 2>/dev/null || [ ! -s "$_img" ]; then
		rm -f "$_img"
		ota_status "failed" "image download failed"
		ota_print_context "$_check_out"
		echo "error=download-failed"
		return 1
	fi
	if ! uclient-fetch -q -O "$_imgsig" "$_sig_url" 2>/dev/null || [ ! -s "$_imgsig" ]; then
		rm -f "$_img" "$_imgsig"
		ota_status "failed" "image signature download failed"
		ota_print_context "$_check_out"
		echo "error=download-failed"
		return 1
	fi

	ota_status "verifying"
	local _got_sha
	_got_sha="$(sha256sum "$_img" 2>/dev/null | cut -d' ' -f1)"
	if [ "$_got_sha" != "$_sha256" ]; then
		rm -f "$_img" "$_imgsig"
		# A freshly re-published asset can serve stale bytes briefly on
		# GitHub's release CDN (seen live during firmware-hosting work) --
		# say so rather than implying the image is corrupt.
		ota_status "failed" "image sha256 mismatch -- if this was just published, retry in a few minutes (CDN staleness), otherwise do not install it"
		ota_print_context "$_check_out"
		echo "error=hash-mismatch"
		echo "got_sha256=$_got_sha"
		return 1
	fi
	if ! ota_verify_sig "$_img"; then
		rm -f "$_img" "$_imgsig"
		ota_status "failed" "image signature verification failed"
		ota_print_context "$_check_out"
		echo "error=bad-signature"
		return 1
	fi

	ota_status "ready"
	ota_print_context "$_check_out"
	echo "result=downloaded"
	echo "image=$_img"
	return 0
}

# ─── verify ───────────────────────────────────────────────────────────────
# Re-checks an already-downloaded image (idempotent). Re-derives the
# expected sha256 from a fresh `check` rather than trusting a stale local
# copy of a previous check's output.
cmd_verify() {
	local _img="$WORK_DIR/ota.img"
	if [ ! -f "$_img" ]; then
		echo "result=error"
		echo "error=no-image"
		return 1
	fi
	local _check_out _result _regressed _sha256 _got_sha
	_check_out="$(cmd_check)" || { ota_print_context "$_check_out"; return 1; }
	_result="$(printf '%s\n' "$_check_out" | sed -n 's/^result=//p')"
	_sha256="$(printf '%s\n' "$_check_out" | sed -n 's/^sha256=//p')"
	if [ "$_result" != "update-available" ] || [ -z "$_sha256" ]; then
		ota_print_context "$_check_out"
		echo "error=no-update-available"
		return 1
	fi
	# Same hard block as cmd_download, re-derived fresh rather than trusted
	# from an earlier download's belief -- see the anti-replay comment in
	# cmd_check for why this lives at verify/download/apply and not check.
	_regressed="$(printf '%s\n' "$_check_out" | sed -n 's/^manifest_regressed=//p')"
	if [ "$_regressed" = "1" ]; then
		echo "result=error"
		echo "error=stale-manifest"
		return 1
	fi
	_got_sha="$(sha256sum "$_img" 2>/dev/null | cut -d' ' -f1)"
	if [ "$_got_sha" != "$_sha256" ]; then
		echo "result=error"
		echo "error=hash-mismatch"
		return 1
	fi
	if ! ota_verify_sig "$_img"; then
		echo "result=error"
		echo "error=bad-signature"
		return 1
	fi
	echo "result=verified"
	echo "image=$_img"
	return 0
}

# Config-survival seam (RFC #62 / #97 companion). #97 (the settings-profile
# exporter) does not exist yet -- v1 applies with sysupgrade's own
# keep-settings default, nothing more. This function is the seam #97 will
# fill: export a stash tarball here and pass it to `sysupgrade -f <stash>`
# instead of the plain keep-settings call below. Kept as an explicit no-op
# rather than skipped entirely so the C2->#97 wiring point is one function,
# not a grep through cmd_apply.
ota_export_stash() {
	printf ''
}

# ─── apply ────────────────────────────────────────────────────────────────
# Flashes an already-downloaded, already-verified image. This is the one
# irreversible subcommand: once `sysupgrade` starts writing, single-
# partition hardware (e.g. MT6000) has no A/B slot to fall back to, so
# every check that matters must happen BEFORE this point, never during or
# after -- there is no "after" in this process (sysupgrade replaces the
# running system; a caller invoking this must expect the connection/process
# to end here, not return).
#
# Order (fail-closed, matches the RFC's anti-brick section):
#   1. re-verify (fresh check + sha256 + usign sig -- cmd_verify, not a
#      cached belief that a prior verify succeeded)
#   2. stock OpenWrt device-match/compat gate (validate_firmware_image --
#      the SAME check the manual upload page relies on; see do_upgrade.sh)
#   3. record the applied sha256 (survives via UCI, see ota_state_set)
#      BEFORE flashing -- there is no reliable "after" to write it in
#   4. flash
#
# Never passes sysupgrade's `-F` (force): forcing is explicitly the manual
# page's job, gated behind its own checkbox and an admin who has read the
# warning it shows. The OTA path only ever flashes an image that passed
# every fail-closed check; force would defeat the entire point of it.
cmd_apply() {
	# $1 = "clean" to wipe settings (sysupgrade -n) instead of the default
	# keep-settings behaviour (plain `sysupgrade <img>`, no flag).
	local _mode="$1"
	local _img="$WORK_DIR/ota.img"

	local _verify_out _verify_result
	_verify_out="$(cmd_verify)" || true
	_verify_result="$(printf '%s\n' "$_verify_out" | sed -n 's/^result=//p')"
	if [ "$_verify_result" != "verified" ]; then
		ota_status "failed" "apply refused: image did not re-verify"
		# ota_print_context strips only verify's `result=` line, not its
		# `error=` -- that error (no-image/hash-mismatch/bad-signature) is
		# the actual useful diagnostic; apply's own error=not-verified below
		# is the single authoritative RESULT, not a replacement for it.
		ota_print_context "$_verify_out"
		echo "error=not-verified"
		return 1
	fi

	ota_status "validating"
	local _vfi_json _vfi_err="$WORK_DIR/validate.stderr"
	_vfi_json="$(/usr/libexec/validate_firmware_image "$_img" 2>"$_vfi_err")" || true
	local _valid _devmatch
	_valid="$(printf '%s' "$_vfi_json" | jsonfilter -e '@.valid' 2>/dev/null)" || true
	_devmatch="$(printf '%s' "$_vfi_json" | jsonfilter -e '@.tests.fwtool_device_match' 2>/dev/null)" || true
	if [ "$_valid" != "true" ]; then
		ota_status "failed" "apply refused: validate_firmware_image rejected the image (device mismatch or incompatible)"
		echo "result=error"
		echo "error=image-rejected"
		echo "valid=$_valid"
		echo "device_match=$_devmatch"
		echo "detail=$(cat "$_vfi_err" 2>/dev/null | tr '\n' ' ')"
		return 1
	fi

	# The applied sha256 becomes the new "up-to-date" marker for future
	# `check` calls. Written now, not after sysupgrade returns, because
	# sysupgrade never returns on success -- it replaces the running system.
	local _got_sha
	_got_sha="$(sha256sum "$_img" 2>/dev/null | cut -d' ' -f1)"
	ota_state_set applied_sha256 "$_got_sha"

	ota_export_stash

	local _flags=""
	[ "$_mode" = "clean" ] && _flags="-n"

	ota_status "applying"
	# shellcheck disable=SC2086
	exec sysupgrade $_flags "$_img"
}

case "$1" in
	check)    cmd_check ;;
	download) cmd_download ;;
	verify)   cmd_verify ;;
	apply)    cmd_apply "$2" ;;
	*)
		echo "usage: $0 {check|download|verify|apply [clean]}" >&2
		exit 2
		;;
esac
