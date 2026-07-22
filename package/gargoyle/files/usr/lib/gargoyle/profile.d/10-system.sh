#!/bin/sh
# Settings-profile part: system identity (RFC #97).
# Destination: /usr/lib/gargoyle/profile.d/10-system.sh
#
# Tier 1 (portable verbatim): hostname, timezone, and the admin password
# *hash*. Runs first (NN=10) so the router's identity is set before any part
# that references it.
#
# Password note (important for reviewers): the GUI sets passwords by piping
# PLAINTEXT to `passwd root` (access.js:207 / firstboot.js:30). A profile must
# never carry plaintext and cannot re-run passwd across a clean flash, so this
# part carries the already-hashed /etc/shadow root entry and the importer
# splices it back in -- exactly as restore.sh restores /etc/shadow
# (restore.sh:238-240). A redacted export (P3) drops this field.

[ -e /usr/share/libubox/jshn.sh ] || exit 0
. /usr/share/libubox/jshn.sh
[ -e /usr/lib/gargoyle/profile_lib.sh ] && . /usr/lib/gargoyle/profile_lib.sh

sys_export()
{
	_hostname=$(uci -q get system.@system[0].hostname)
	_timezone=$(uci -q get system.@system[0].timezone)
	_tzposix=$(cat /etc/TZ 2>/dev/null)
	_shadow=$(awk -F: '$1=="root"{print $2}' /etc/shadow 2>/dev/null)

	json_init
	json_add_object system
	json_add_string hostname "$_hostname"
	json_add_string timezone "$_timezone"
	json_add_string timezone_posix "$_tzposix"
	json_add_string password_shadow "$_shadow"
	json_close_object
	json_dump
}

sys_import()
{
	_prof="$1"
	[ -f "$_prof" ] || return 1
	json_init
	json_load_file "$_prof" 2>/dev/null || return 1
	json_is_a system object || return 0    # nothing to import, not an error
	json_select system

	_hostname=""
	_timezone=""
	_tzposix=""
	_shadow=""
	json_get_var _hostname hostname
	json_get_var _timezone timezone
	json_get_var _tzposix timezone_posix
	json_get_var _shadow password_shadow

	if [ -n "$_hostname" ] ; then
		uci set system.@system[0].hostname="$_hostname"
		echo "$_hostname" > /proc/sys/kernel/hostname 2>/dev/null
		profile_report_add system hostname applied ""
	fi

	if [ -n "$_timezone" ] ; then
		uci set system.@system[0].timezone="$_timezone"
		[ -n "$_tzposix" ] && echo "$_tzposix" > /etc/TZ
		[ -x /usr/bin/set_kernel_timezone ] && set_kernel_timezone 2>/dev/null
		profile_report_add system timezone applied ""
	fi

	if [ -n "$_shadow" ] ; then
		# splice the carried hash into root's field 2, preserving all other
		# fields and every other account line. ENVIRON avoids awk -v escape
		# processing of the hash string.
		_shadow="$_shadow" awk -F: 'BEGIN { OFS=":"; h=ENVIRON["_shadow"] } $1=="root" { $2=h } { print }' /etc/shadow > /tmp/shadow.prof 2>/dev/null \
			&& cat /tmp/shadow.prof > /etc/shadow \
			&& rm -f /tmp/shadow.prof
		profile_report_add system password applied ""
	fi

	json_select ..
}

case "$1" in
	export)
		sys_export
		;;
	import)
		sys_import "$2"
		;;
	*)
		echo "Usage: $0 export|import [profile]" >&2
		exit 1
		;;
esac
