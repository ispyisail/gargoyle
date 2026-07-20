#!/bin/sh
# Settings-profile part: LAN addressing + DHCP (RFC #97).
# Destination: /usr/lib/gargoyle/profile.d/20-lan.sh
#
# Tier 1 (portable verbatim): the LAN IP/netmask, the LAN domain, and the
# DHCP server settings (enabled, pool start/limit, lease time) carry to any
# router unchanged -- none of it is hardware- or radio-specific. Runs at NN=20
# so LAN addressing is in place before wifi (30) and anything that references
# the LAN subnet.
#
# CIDR note: on OpenWrt 24.10+ network.lan.ipaddr can be stored in CIDR form
# ("192.168.1.1/24") with no separate netmask. The exporter normalises that
# back to a bare ipaddr + dotted netmask so the profile is portable to any
# version's importer (the bare form is what every release accepts).

[ -e /usr/share/libubox/jshn.sh ] || exit 0
. /usr/share/libubox/jshn.sh
[ -e /usr/lib/gargoyle/profile_lib.sh ] && . /usr/lib/gargoyle/profile_lib.sh

# --- pure helper (unit-tested) ------------------------------------------

# lan_prefix_to_netmask <0-32> -> dotted netmask (empty on bad input)
lan_prefix_to_netmask()
{
	_p="$1"
	case "$_p" in
		''|*[!0-9]*) echo "" ; return ;;
	esac
	[ "$_p" -ge 0 ] 2>/dev/null && [ "$_p" -le 32 ] 2>/dev/null || { echo "" ; return ; }
	_o1=0; _o2=0; _o3=0; _o4=0
	_i=0
	for _oct in 1 2 3 4 ; do
		_bits=$(( _p - _i ))
		if [ "$_bits" -ge 8 ] ; then
			_v=255
		elif [ "$_bits" -le 0 ] ; then
			_v=0
		else
			# 256 - 2^(8-bits)
			_sh=$(( 8 - _bits ))
			_pow=1
			_c=0
			while [ "$_c" -lt "$_sh" ] ; do _pow=$(( _pow * 2 )); _c=$(( _c + 1 )); done
			_v=$(( 256 - _pow ))
		fi
		eval "_o${_oct}=$_v"
		_i=$(( _i + 8 ))
	done
	echo "${_o1}.${_o2}.${_o3}.${_o4}"
}

# --- export -------------------------------------------------------------

lan_export()
{
	_ipaddr=$(uci -q get network.lan.ipaddr)
	_netmask=$(uci -q get network.lan.netmask)
	# split a CIDR ipaddr (24.10+) into bare ip + derived netmask
	case "$_ipaddr" in
		*/*)
			_pfx=${_ipaddr#*/}
			_ipaddr=${_ipaddr%%/*}
			[ -n "$_netmask" ] || _netmask=$(lan_prefix_to_netmask "$_pfx")
			;;
	esac
	_domain=$(uci -q get "dhcp.@dnsmasq[0].domain")
	_start=$(uci -q get dhcp.lan.start)
	_limit=$(uci -q get dhcp.lan.limit)
	_lease=$(uci -q get dhcp.lan.leasetime)
	# DHCP is enabled unless dhcp.lan.ignore == 1 (dhcp.js:330)
	_ignore=$(uci -q get dhcp.lan.ignore)
	if [ "$_ignore" = "1" ] ; then _enabled=0 ; else _enabled=1 ; fi

	json_init
	json_add_object lan
	json_add_string ipaddr "$_ipaddr"
	json_add_string netmask "$_netmask"
	json_add_string domain "$_domain"
	json_add_object dhcp
	json_add_string enabled "$_enabled"
	json_add_string start "$_start"
	json_add_string limit "$_limit"
	json_add_string leasetime "$_lease"
	json_close_object
	json_close_object
	json_dump
}

# --- import -------------------------------------------------------------

lan_import()
{
	_prof="$1"
	[ -f "$_prof" ] || return 1
	json_init
	json_load_file "$_prof" 2>/dev/null || return 1
	json_is_a lan object || return 0     # no lan block, not an error
	json_select lan

	_ipaddr=""; _netmask=""; _domain=""
	json_get_var _ipaddr ipaddr
	json_get_var _netmask netmask
	json_get_var _domain domain

	if [ -n "$_ipaddr" ] ; then
		uci set network.lan.ipaddr="$_ipaddr"
		[ -n "$_netmask" ] && uci set network.lan.netmask="$_netmask"
		profile_report_add lan ipaddr applied ""
	fi
	if [ -n "$_domain" ] ; then
		uci set "dhcp.@dnsmasq[0].domain=$_domain"
		profile_report_add lan domain applied ""
	fi

	if json_is_a dhcp object ; then
		json_select dhcp
		_enabled=""; _start=""; _limit=""; _lease=""
		json_get_var _enabled enabled
		json_get_var _start start
		json_get_var _limit limit
		json_get_var _lease leasetime

		[ -n "$_start" ] && uci set dhcp.lan.start="$_start"
		[ -n "$_limit" ] && uci set dhcp.lan.limit="$_limit"
		[ -n "$_lease" ] && uci set dhcp.lan.leasetime="$_lease"
		if [ "$_enabled" = "0" ] ; then
			uci set dhcp.lan.ignore='1'
		else
			uci -q delete dhcp.lan.ignore 2>/dev/null
		fi
		profile_report_add lan dhcp applied ""
		json_select ..
	fi

	json_select ..
}

# Dispatch only when executed directly; guarded on $0 so a unit test may
# source this file to reach lan_prefix_to_netmask without the usage branch
# aborting the sourcing shell.
case "$0" in
	*/20-lan.sh|20-lan.sh)
		case "$1" in
			export) lan_export ;;
			import) lan_import "$2" ;;
			*)      echo "Usage: $0 export|import [profile]" >&2 ; exit 1 ;;
		esac
		;;
esac
