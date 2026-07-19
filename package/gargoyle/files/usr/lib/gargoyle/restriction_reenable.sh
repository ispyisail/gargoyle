#!/bin/sh
# This program is copyright © 2026 and is distributed under the terms of the GNU GPL
# version 2.0 with a special clarification/exception that permits adapting the program to
# configure proprietary "back end" software provided that all modifications to the web interface
# itself remain covered by the GPL.
# See http://gargoyle-router.com/faq.html#qfoss for more information
#
# restriction_reenable.sh — timed auto-re-enable for Restriction rules
#
# A restriction_rule/whitelist_rule section that's been temporarily disabled
# (rather than permanently unchecked) carries option reenable_at, a future
# unix timestamp. This script's sweep subcommand flips enabled back to 1 and
# clears reenable_at for every rule whose time has come, committing once and
# restarting the firewall once per sweep run regardless of how many rules
# fired -- never per rule. reenable_at is only ever meaningful when
# enabled=="0"; a rule with enabled=="0" and no reenable_at is a plain,
# permanent disable exactly as it always has been, unaffected by this script.
#
# install_cron registers a `* * * * *` line for this script's sweep -- always
# present once installed, self-healing on every call, not conditionally
# added/removed like a single feature-wide toggle (ping-watchdog/OTA
# autocheck) would be, because any number of rules can have independent,
# simultaneous pending timers with no single "is this feature on" bit to
# hang add/remove logic off. Called from ifup_firewall() (see
# manage_groups.sh, called from the same hook) so a lost cron line self-heals
# on the next boot or firewall reload, not just at package install.
#
# Usage: sh restriction_reenable.sh sweep
#        sh restriction_reenable.sh install_cron

# next_local_midnight -- seconds since epoch for the next local-midnight
# boundary, using the router's own tz offset (date +%z, e.g. "+1200"). Pure
# integer arithmetic, not `date -d`, which isn't a proven-available BusyBox
# date feature on this firmware. A leading "0" on the HH/MM fields (e.g.
# "08") is stripped via plain parameter expansion before arithmetic --
# NOT a `10#` base-10 arithmetic prefix, which shellcheck flags as
# undefined behavior in POSIX sh (SC3052) and isn't worth trusting on this
# BusyBox ash without a live check; `${var#0}` is unambiguous POSIX
# parameter expansion and strips at most the one leading zero a 2-digit
# field can ever have ("00" -> "0", "08" -> "8", "12" unchanged).
next_local_midnight()
{
	now=$(date +%s) || return 1
	off_raw=$(date +%z 2>/dev/null) || off_raw="+0000"
	off_sign=$(printf '%s' "$off_raw" | cut -c1)
	off_hh=$(printf '%s' "$off_raw" | cut -c2-3); off_hh=${off_hh#0}
	off_mm=$(printf '%s' "$off_raw" | cut -c4-5); off_mm=${off_mm#0}
	off_sec=$((off_hh * 3600 + off_mm * 60))
	[ "$off_sign" = "-" ] && off_sec=$((0 - off_sec))

	local_now=$((now + off_sec))
	local_midnight_today=$((local_now - (local_now % 86400)))
	printf '%s\n' $((local_midnight_today + 86400 - off_sec))
}

# sweep -- re-enable every restriction_rule/whitelist_rule section whose
# reenable_at has passed. One uci commit and one restart_firewall.sh for the
# whole run if anything changed, never per rule.
sweep()
{
	now=$(date +%s) || return 1
	changed=0

	# Section-TYPE declaration lines are unquoted ("firewall.id=restriction_rule"),
	# unlike option-value lines ("firewall.id.option='value'") -- confirmed
	# live against the real uci binary, not assumed from the option-line shape.
	sections=$(uci show firewall 2>/dev/null | grep -E '^firewall\.[^.=]+=(restriction_rule|whitelist_rule)$' | sed "s/^firewall\.\([^.=]*\)=.*/\1/") || sections=""

	for section in $sections; do
		reenable_at=$(uci -q get "firewall.$section.reenable_at") || reenable_at=""
		case "$reenable_at" in
			''|*[!0-9]*)
				# Unset, or not a plain non-negative integer -- nothing
				# pending for this section. Guarding this BEFORE the
				# numeric [ -le ] test below (rather than letting a
				# garbage value reach it) is deliberate: this project has
				# hit the "unguarded uci get assignment aborts silently
				# under set -e" bug class twice already.
				continue
				;;
		esac
		if [ "$reenable_at" -le "$now" ]; then
			uci set "firewall.$section.enabled=1"
			uci delete "firewall.$section.reenable_at" 2>/dev/null
			changed=1
		fi
	done

	if [ "$changed" = "1" ]; then
		uci commit firewall
		sh /usr/lib/gargoyle/restart_firewall.sh
	fi
	return 0
}

# install_cron -- idempotent. Safe to call on every boot/firewall reload.
install_cron()
{
	tmp="/tmp/tmp.restriction_reenable.cron.$$"
	mkdir -p /etc/crontabs
	touch /etc/crontabs/root
	grep -v 'restriction_reenable.sh sweep' /etc/crontabs/root > "$tmp" 2>/dev/null
	echo '* * * * * sh /usr/lib/gargoyle/restriction_reenable.sh sweep' >> "$tmp"
	mv "$tmp" /etc/crontabs/root
	/etc/init.d/cron restart >/dev/null 2>&1
	return 0
}

# Dispatch only when this file is EXECUTED directly, never when it's
# SOURCED (as restrictions.js's own generated "until tomorrow" command does:
# `. /usr/lib/gargoyle/restriction_reenable.sh; next_local_midnight`, to
# reuse this same offset arithmetic instead of duplicating it in the
# frontend's command string). Sourcing leaves $0 as the CALLING script's own
# path, not this file's -- so without this guard, sourcing would also run
# the trailing case's `*)` branch against whatever $1 the caller happens to
# have and `exit 1` the sourcing shell before next_local_midnight ever ran.
case "$0" in
	*/restriction_reenable.sh|restriction_reenable.sh)
		case "$1" in
			sweep)        sweep ;;
			install_cron) install_cron ;;
			*)            echo "Usage: $0 sweep|install_cron" >&2; exit 1 ;;
		esac
		;;
esac
