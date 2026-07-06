#!/bin/sh
#
# safe_apply.sh -- snapshot + watchdog + auto-revert for network/firewall/dhcp
# config changes that can sever the admin's own access to the router (a bad
# WAN VLAN, or worse, a bad LAN port retag). basic.js/vlan.js route
# VLAN-affecting saves through utility/safe_apply_run.sh instead of posting
# straight to run_commands.sh; this library backs that endpoint plus the
# detached watchdog process and the boot-time recovery check.
#
# Usage (see utility/safe_apply_run.sh, safe_apply_confirm.sh, and the
# safe_apply_recover init script for the actual call sites):
#   safe_apply.sh snapshot <id> <timeout>
#   safe_apply.sh watchdog <id> <timeout>
#   safe_apply.sh restore  <id>          # used by the live watchdog
#   safe_apply.sh boot-recover           # used at boot, files-only, no restarts
#

SAFE_APPLY_CONFIG_DIR="${SAFE_APPLY_CONFIG_DIR:-/etc/config}"
SAFE_APPLY_PERSIST_DIR="${SAFE_APPLY_PERSIST_DIR:-/etc/gargoyle/safe_apply}"
SAFE_APPLY_RUNTIME_DIR="${SAFE_APPLY_RUNTIME_DIR:-/tmp/safe_apply}"
SAFE_APPLY_POLL_INTERVAL="${SAFE_APPLY_POLL_INTERVAL:-2}"
SAFE_APPLY_CONFIGS="network firewall dhcp"

# A valid id is exactly "<epoch>_<pid>" -- generated server-side by
# safe_apply_run.sh, but re-validated here (and by every CGI that accepts one
# from a client request) before it is ever used to build a filesystem path.
safe_apply_valid_id()
{
	echo "$1" | grep -qE '^[0-9]+_[0-9]+$'
}

safe_apply_snapshot()
{
	id="$1"; timeout="$2"
	safe_apply_valid_id "$id" || return 1

	pdir="$SAFE_APPLY_PERSIST_DIR/$id"
	rdir="$SAFE_APPLY_RUNTIME_DIR/$id"
	mkdir -p "$pdir" "$rdir"

	for cfg in $SAFE_APPLY_CONFIGS ; do
		[ -e "$SAFE_APPLY_CONFIG_DIR/$cfg" ] && cp -p "$SAFE_APPLY_CONFIG_DIR/$cfg" "$pdir/$cfg.bak"
	done

	printf 'started=%s\ntimeout=%s\n' "$(date +%s)" "$timeout" > "$rdir/meta"
}

# Copies the snapshotted config files back into place. Deliberately does NOT
# restart any service -- called both by safe_apply_restore() (which adds the
# restarts, for the live in-session revert) and by safe_apply_boot_recover()
# (which relies on the normal boot sequence to start services next, using
# the now-restored config -- restarting a not-yet-started service mid-boot
# is unnecessary and, on some init scripts, not well-defined).
safe_apply_restore_files()
{
	id="$1"
	safe_apply_valid_id "$id" || return 1

	pdir="$SAFE_APPLY_PERSIST_DIR/$id"
	[ -d "$pdir" ] || return 1

	for cfg in $SAFE_APPLY_CONFIGS ; do
		[ -e "$pdir/$cfg.bak" ] && cp -p "$pdir/$cfg.bak" "$SAFE_APPLY_CONFIG_DIR/$cfg"
	done

	rm -rf "$pdir"
}

safe_apply_restore()
{
	id="$1"
	safe_apply_restore_files "$id" || return 0

	/etc/init.d/network restart >/dev/null 2>&1

	if [ -e /usr/lib/gargoyle_firewall_util/gargoyle_firewall_util.sh ] ; then
		. /usr/lib/gargoyle_firewall_util/gargoyle_firewall_util.sh
		ifup_firewall >/dev/null 2>&1
	else
		/etc/init.d/firewall restart >/dev/null 2>&1
	fi
}

# Runs at boot (see the safe_apply_recover init script), before network and
# firewall start. Restores config for every snapshot still sitting in the
# persistent dir -- i.e. every safe-apply that was never confirmed, whether
# because the change locked the admin out, or because the router lost power
# mid-confirmation-window (the runtime/confirm markers live in /tmp, which
# does not survive a reboot, so "snapshot still present" is exactly the
# signal that it was never confirmed).
safe_apply_boot_recover()
{
	[ -d "$SAFE_APPLY_PERSIST_DIR" ] || return 0
	for pdir in "$SAFE_APPLY_PERSIST_DIR"/*/ ; do
		[ -d "$pdir" ] || continue
		id="$(basename "$pdir")"
		safe_apply_valid_id "$id" || continue
		safe_apply_restore_files "$id"
	done
}

# Launched detached (start-stop-daemon -b) by safe_apply_run.sh. Polls for a
# confirm/abort marker in the runtime dir; reverts on timeout or abort.
safe_apply_watchdog()
{
	id="$1"; timeout="$2"
	safe_apply_valid_id "$id" || exit 1

	rdir="$SAFE_APPLY_RUNTIME_DIR/$id"
	elapsed=0

	while [ "$elapsed" -lt "$timeout" ] ; do
		if [ -e "$rdir/confirmed" ] ; then
			# Confirmed: the change is intentional, drop the snapshot so a
			# later, unrelated reboot never mistakes it for an unconfirmed one.
			rm -rf "$SAFE_APPLY_PERSIST_DIR/$id" "$rdir"
			exit 0
		fi
		if [ -e "$rdir/abort" ] ; then
			safe_apply_restore "$id"
			rm -rf "$rdir"
			exit 0
		fi
		sleep "$SAFE_APPLY_POLL_INTERVAL"
		elapsed=$((elapsed + SAFE_APPLY_POLL_INTERVAL))
	done

	# Timed out with no confirmation: revert.
	safe_apply_restore "$id"
	rm -rf "$rdir"
}

case "$1" in
	snapshot)     shift; safe_apply_snapshot     "$@" ;;
	restore)      shift; safe_apply_restore      "$@" ;;
	boot-recover) shift; safe_apply_boot_recover  "$@" ;;
	watchdog)     shift; safe_apply_watchdog     "$@" ;;
esac
