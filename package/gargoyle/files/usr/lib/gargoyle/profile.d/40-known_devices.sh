#!/bin/sh
# Settings-profile part: Known Devices / Device Groups (RFC #97).
# Destination: /usr/lib/gargoyle/profile.d/40-known_devices.sh
#
# Tier 1 (portable verbatim): every known device is a `config host` section
# in /etc/config/dhcp, keyed by MAC. Nothing here is hardware- or
# version-specific -- a MAC, a name, an optional static IP, optional IPv6
# hostid/DUID, and an optional group name (groups are just the set of unique
# `group` values across host sections; there is no separate group section).
#
# Import semantics = the profile is the desired state: existing host sections
# are cleared and recreated from the profile, so a re-import is idempotent and
# never leaves a duplicate dhcp-host (the class of bug that once crash-looped
# dnsmasq). Runs at NN=40, after LAN addressing (20) that a static IP sits in.

[ -e /usr/share/libubox/jshn.sh ] || exit 0
. /usr/share/libubox/jshn.sh
[ -e /usr/lib/gargoyle/profile_lib.sh ] && . /usr/lib/gargoyle/profile_lib.sh

# --- export -------------------------------------------------------------

kd_export()
{
	# Read the section list FIRST (a piped `while` would build the JSON array
	# in a subshell and lose it -- same trap as 30-wifi's exporter).
	_secs=$(uci show dhcp 2>/dev/null | grep '=host$' | sed 's/^dhcp\.\(.*\)=host$/\1/')
	json_init
	json_add_array known_devices
	for _s in $_secs ; do
		_mac=$(uci -q get "dhcp.${_s}.mac")
		[ -n "$_mac" ] || continue     # a known device is keyed by MAC
		_name=$(uci -q get "dhcp.${_s}.name")
		_ip=$(uci -q get "dhcp.${_s}.ip")
		_group=$(uci -q get "dhcp.${_s}.group")
		_hostid=$(uci -q get "dhcp.${_s}.hostid")
		_duid=$(uci -q get "dhcp.${_s}.duid")
		json_add_object
		json_add_string mac "$_mac"
		json_add_string name "$_name"
		json_add_string ip "$_ip"
		json_add_string group "$_group"
		json_add_string hostid "$_hostid"
		json_add_string duid "$_duid"
		json_close_object
	done
	json_close_array
	json_dump
}

# --- import -------------------------------------------------------------

kd_import()
{
	_prof="$1"
	[ -f "$_prof" ] || return 1
	json_init
	json_load_file "$_prof" 2>/dev/null || return 1
	json_is_a known_devices array || return 0   # nothing to import, not an error

	# Clear existing host sections (desired-state replace). Collect first,
	# then delete -- don't delete while iterating uci's own output.
	_old=$(uci show dhcp 2>/dev/null | grep '=host$' | sed 's/^dhcp\.\(.*\)=host$/\1/')
	for _s in $_old ; do
		uci -q delete "dhcp.${_s}" 2>/dev/null
	done

	json_select known_devices
	json_get_keys _idx
	_n=0
	for _i in $_idx ; do
		json_select "$_i"
		_mac=""; _name=""; _ip=""; _group=""; _hostid=""; _duid=""
		json_get_var _mac mac
		json_get_var _name name
		json_get_var _ip ip
		json_get_var _group group
		json_get_var _hostid hostid
		json_get_var _duid duid
		json_select ..
		if [ -z "$_mac" ] ; then
			profile_report_add known_devices "device[$_i]" dropped "entry has no MAC"
			continue
		fi
		_n=$(( _n + 1 ))
		_sec="static_host_${_n}"
		uci set "dhcp.${_sec}=host"
		uci set "dhcp.${_sec}.mac=$_mac"
		[ -n "$_name" ]   && uci set "dhcp.${_sec}.name=$_name"
		[ -n "$_ip" ]     && uci set "dhcp.${_sec}.ip=$_ip"
		[ -n "$_group" ]  && uci set "dhcp.${_sec}.group=$_group"
		[ -n "$_hostid" ] && uci set "dhcp.${_sec}.hostid=$_hostid"
		[ -n "$_duid" ]   && uci set "dhcp.${_sec}.duid=$_duid"
		profile_report_add known_devices "$_mac" applied ""
	done
	json_select ..
}

# Dispatch only when executed directly ($0 guard lets a test source the file).
case "$0" in
	*/40-known_devices.sh|40-known_devices.sh)
		case "$1" in
			export) kd_export ;;
			import) kd_import "$2" ;;
			*)      echo "Usage: $0 export|import [profile]" >&2 ; exit 1 ;;
		esac
		;;
esac
