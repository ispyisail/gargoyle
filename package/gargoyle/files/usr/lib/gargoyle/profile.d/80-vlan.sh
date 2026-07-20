#!/bin/sh
# Settings-profile part: LAN VLAN Manager (RFC #97) -- the Tier-2 hook.
# Destination: /usr/lib/gargoyle/profile.d/80-vlan.sh
#
# This is the part that exercises the cross-HARDWARE port mapping. A VLAN's
# per-port membership is captured by port ROLE NAME (lan1, lan2...), not by
# device, so it can land on a different router -- and the Tier-2 degradation
# is: a port the profile references that the target does not physically have
# is dropped from that VLAN's membership (cap_port_role_exists), reported, and
# never written. A VLAN that loses every one of its ports is still created
# (an admin can add ports later) but reported adapted.
#
# Runs LAST (NN=80): VLANs reference LAN addressing (20) and are the most
# invasive change. The reconstruction mirrors vlan.js's own save: enable
# bridge vlan_filtering, move network.lan.device to br-lan.1, create a
# bridge-vlan per VLAN (default VLAN 1 included), plus per-user-VLAN
# interface + dhcp + firewall zone + wan-forward, and the inter-VLAN access
# matrix. Only the pinhole exception rules are deferred (a VLAN routes
# without them; they are a follow-up).
#
# DSA only: the whole VLAN Manager gates on board.json exposing
# network.lan.ports (vlan.sh does the same). On a board without it,
# cap_lan_port_count is 0 and this part imports nothing.

[ -e /usr/share/libubox/jshn.sh ] || exit 0
. /usr/share/libubox/jshn.sh
[ -e /usr/lib/gargoyle/profile_lib.sh ] && . /usr/lib/gargoyle/profile_lib.sh

# --- pure helper (unit-tested) ------------------------------------------

# vlan_port_role <port_entry> -> role name (strip the :u*/:t suffix)
vlan_port_role() { echo "${1%%:*}" ; }

# vlan_port_is_tagged <port_entry> -> 1 if the suffix marks it tagged (:t),
# 0 for native (:u*, or no suffix). Matches switchinfo.sh get_vlan_membership.
vlan_port_is_tagged()
{
	_sfx="${1#*:}"
	case "$_sfx" in
		*t*) echo 1 ;;
		*)   echo 0 ;;
	esac
}

# --- export -------------------------------------------------------------

vlan_export()
{
	json_init
	json_add_object vlan
	# The feature is only in use when bridge vlan_filtering is on.
	if [ "$(uci -q get network.brlan_dev.vlan_filtering)" = "1" ] ; then
		_secs=$(uci show network 2>/dev/null | grep '=bridge-vlan' | sed 's/^network\.\(.*\)=bridge-vlan$/\1/')
		json_add_array vlans
		for _s in $_secs ; do
			_vid=$(uci -q get "network.${_s}.vlan")
			[ -n "$_vid" ] || continue
			_name=$(uci -q get "network.${_s}.gargoyle_desc")
			# split the ports list into native/tagged role names
			_native=""; _tagged=""
			for _p in $(uci -q get "network.${_s}.ports" 2>/dev/null) ; do
				_role=$(vlan_port_role "$_p")
				if [ "$(vlan_port_is_tagged "$_p")" = "1" ] ; then
					_tagged="$_tagged $_role"
				else
					_native="$_native $_role"
				fi
			done
			# user VLANs (id != 1) carry their own interface + dhcp
			_iface="vlan${_vid}"
			_ip=$(uci -q get "network.${_iface}.ipaddr")
			_mask=$(uci -q get "network.${_iface}.netmask")
			_dstart=$(uci -q get "dhcp.${_iface}.start")
			_dlimit=$(uci -q get "dhcp.${_iface}.limit")
			_dign=$(uci -q get "dhcp.${_iface}.ignore")
			if [ "$_dign" = "1" ] ; then _den=0 ; else _den=1 ; fi

			json_add_object
			json_add_string id "$_vid"
			json_add_string name "$_name"
			json_add_string ipaddr "$_ip"
			json_add_string netmask "$_mask"
			json_add_object dhcp
			json_add_string enabled "$_den"
			json_add_string start "$_dstart"
			json_add_string limit "$_dlimit"
			json_close_object
			json_add_array native_ports
			for _r in $_native ; do json_add_string "" "$_r" ; done
			json_close_array
			json_add_array tagged_ports
			for _r in $_tagged ; do json_add_string "" "$_r" ; done
			json_close_array
			json_close_object
		done
		json_close_array

		# inter-VLAN access matrix: fwd_matrix_<srcVid>_<destVid> sections.
		# The zone name is vlan<id>, so recover the ids from src/dest.
		_msecs=$(uci show firewall 2>/dev/null | grep '=forwarding' | sed 's/^firewall\.\(.*\)=forwarding$/\1/')
		json_add_array matrix
		for _m in $_msecs ; do
			case "$_m" in fwd_matrix_*) ;; *) continue ;; esac
			_src=$(uci -q get "firewall.${_m}.src")
			_dst=$(uci -q get "firewall.${_m}.dest")
			json_add_object
			json_add_string src "${_src#vlan}"
			json_add_string dest "${_dst#vlan}"
			json_close_object
		done
		json_close_array
	fi
	json_close_object
	json_dump
}

# --- import -------------------------------------------------------------

# add one port entry to a VLAN's ports list, honoring the target's real ports.
# Sets _vlan_dropped=1 (global) if the role was dropped for not existing.
_vlan_ports_accum=""
_vlan_dropped_roles=""
_append_port()
{
	_role="$1"; _suffix="$2"
	if [ "$(cap_port_role_exists "$_role")" = "1" ] ; then
		_vlan_ports_accum="$_vlan_ports_accum ${_role}${_suffix}"
	else
		_vlan_dropped_roles="$_vlan_dropped_roles $_role"
	fi
}

vlan_import()
{
	_prof="$1"
	[ -f "$_prof" ] || return 1
	json_init
	json_load_file "$_prof" 2>/dev/null || return 1
	json_is_a vlan object || return 0
	json_select vlan
	if ! json_is_a vlans array ; then json_select .. ; return 0 ; fi

	# DSA gate: no switch ports on this board -> the VLAN Manager can't apply.
	if [ "$(cap_lan_port_count)" = "0" ] ; then
		profile_report_add vlan "*" dropped "target has no DSA LAN switch ports"
		json_select ..
		return 0
	fi

	json_select vlans
	json_get_keys _vidx
	# is there any user VLAN (id != 1)? if not, the feature isn't in use.
	_have_user=0
	for _i in $_vidx ; do
		json_select "$_i"
		_id=""; json_get_var _id id
		[ -n "$_id" ] && [ "$_id" != "1" ] && _have_user=1
		json_select ..
	done
	if [ "$_have_user" = "0" ] ; then
		json_select ..     # vlans
		json_select ..     # vlan
		return 0
	fi

	# enable filtering + move the router's own LAN onto br-lan.1
	uci set network.brlan_dev.vlan_filtering='1'
	uci set network.lan.device='br-lan.1'

	for _i in $_vidx ; do
		json_select "$_i"
		_id=""; _name=""; _ip=""; _mask=""
		json_get_var _id id
		json_get_var _name name
		json_get_var _ip ipaddr
		json_get_var _mask netmask
		[ -n "$_id" ] || { json_select .. ; continue ; }

		# build the ports list through the capability filter
		_vlan_ports_accum=""
		_vlan_dropped_roles=""
		if json_is_a native_ports array ; then
			json_select native_ports
			json_get_values _nps
			for _r in $_nps ; do _append_port "$_r" ":u*" ; done
			json_select ..
		fi
		if json_is_a tagged_ports array ; then
			json_select tagged_ports
			json_get_values _tps
			for _r in $_tps ; do _append_port "$_r" ":t" ; done
			json_select ..
		fi

		_vsec="vlan_${_id}"
		uci set "network.${_vsec}=bridge-vlan"
		uci set "network.${_vsec}.device=br-lan"
		uci set "network.${_vsec}.vlan=$_id"
		[ -n "$_name" ] && uci set "network.${_vsec}.gargoyle_desc=$_name"
		uci -q delete "network.${_vsec}.ports" 2>/dev/null
		for _pe in $_vlan_ports_accum ; do
			uci add_list "network.${_vsec}.ports=$_pe"
		done

		# user VLANs (id != 1) get their own interface + dhcp + firewall zone
		if [ "$_id" != "1" ] ; then
			_iface="vlan${_id}"
			uci set "network.${_iface}=interface"
			uci set "network.${_iface}.device=br-lan.${_id}"
			uci set "network.${_iface}.proto=static"
			[ -n "$_ip" ]   && uci set "network.${_iface}.ipaddr=$_ip"
			[ -n "$_mask" ] && uci set "network.${_iface}.netmask=$_mask"

			if json_is_a dhcp object ; then
				json_select dhcp
				_den=""; _ds=""; _dl=""
				json_get_var _den enabled
				json_get_var _ds start
				json_get_var _dl limit
				json_select ..
				uci set "dhcp.${_iface}=dhcp"
				uci set "dhcp.${_iface}.interface=$_iface"
				[ -n "$_ds" ] && uci set "dhcp.${_iface}.start=$_ds"
				[ -n "$_dl" ] && uci set "dhcp.${_iface}.limit=$_dl"
				uci set "dhcp.${_iface}.leasetime=12h"
				if [ "$_den" = "0" ] ; then uci set "dhcp.${_iface}.ignore=1" ; else uci -q delete "dhcp.${_iface}.ignore" 2>/dev/null ; fi
			fi

			# own zone: WAN-reachable, input ACCEPT (DHCP/DNS to the router),
			# forward REJECT (isolation is the matrix's job). Mirrors vlan.js.
			_zone="zone_${_iface}"
			uci set "firewall.${_zone}=zone"
			uci set "firewall.${_zone}.name=$_iface"
			uci -q delete "firewall.${_zone}.network" 2>/dev/null
			uci add_list "firewall.${_zone}.network=$_iface"
			uci set "firewall.${_zone}.input=ACCEPT"
			uci set "firewall.${_zone}.output=ACCEPT"
			uci set "firewall.${_zone}.forward=REJECT"
			uci set "firewall.fwd_${_iface}_wan=forwarding"
			uci set "firewall.fwd_${_iface}_wan.src=$_iface"
			uci set "firewall.fwd_${_iface}_wan.dest=wan"
		fi

		# report per-VLAN outcome
		if [ -n "$_vlan_dropped_roles" ] ; then
			profile_report_add vlan "vlan${_id}" adapted "dropped absent port(s):$_vlan_dropped_roles"
		else
			profile_report_add vlan "vlan${_id}" applied ""
		fi
		json_select ..
	done
	json_select ..    # vlans

	# inter-VLAN access matrix (portable, keyed by VLAN id)
	if json_is_a matrix array ; then
		json_select matrix
		json_get_keys _midx
		for _i in $_midx ; do
			json_select "$_i"
			_ms=""; _md=""
			json_get_var _ms src
			json_get_var _md dest
			json_select ..
			[ -n "$_ms" ] && [ -n "$_md" ] || continue
			_fsec="fwd_matrix_${_ms}_${_md}"
			uci set "firewall.${_fsec}=forwarding"
			uci set "firewall.${_fsec}.src=vlan${_ms}"
			uci set "firewall.${_fsec}.dest=vlan${_md}"
		done
		json_select ..
	fi

	json_select ..    # vlan
}

# Dispatch only when executed directly ($0 guard lets a test source the file).
case "$0" in
	*/80-vlan.sh|80-vlan.sh)
		case "$1" in
			export) vlan_export ;;
			import) vlan_import "$2" ;;
			*)      echo "Usage: $0 export|import [profile]" >&2 ; exit 1 ;;
		esac
		;;
esac
