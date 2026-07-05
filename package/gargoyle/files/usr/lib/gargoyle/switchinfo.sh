#!/bin/sh

#
# (c) 2013 Cezary Jackiewicz, http://eko.one.pl
# (c) 2018 Michael Gray
#

[ -e /usr/share/libubox/jshn.sh ] || exit 0
[ -e /usr/lib/gargoyle/ethportinfo.sh ] || exit 0
[ -e /etc/board.json ] || exit 0

. /usr/share/libubox/jshn.sh
. /usr/lib/gargoyle/ethportinfo.sh

# ports.push(["LAN#","STATUS"]);
# On DSA hardware, a third element is appended: a space-separated VLAN
# membership string like "u1 t20 t30" (VLAN 1 untagged/native, VLANs 20 and
# 30 tagged), read by vlan.js's parsePortAssignmentsFromUci(). Scans every
# network.<sec>=bridge-vlan section's `ports` list for this exact port name,
# classifying by suffix: no suffix or ":u"/":*" -> untagged (native); ":t"
# (or ":t*") -> tagged. Only the presence of "t" in the suffix distinguishes
# the two -- confirmed against netifd's own bridge-vlan port-list parser.
get_vlan_membership()
{
	portname="$1"
	uci show network 2>/dev/null | grep '=bridge-vlan' | cut -d= -f1 | cut -d. -f2 | while read -r sec ; do
		vid=$(uci -q get network.${sec}.vlan)
		[ -n "$vid" ] || continue
		for p in $(uci -q get network.${sec}.ports 2>/dev/null) ; do
			pname="${p%%:*}"
			suffix="${p#$pname}"
			if [ "$pname" = "$portname" ] ; then
				case "$suffix" in
					*t*) echo "t${vid}" ;;
					*)   echo "u${vid}" ;;
				esac
			fi
		done
	done
}

json_load_file "/etc/board.json"
json_get_keys BOARDKEYS
for KEY in $BOARDKEYS; do
	[ "$KEY" = "switch" ] && SWITCHTEST="1"
done
json_select network
	json_select lan
		json_get_keys LANKEYS
		for KEY in $LANKEYS; do
			[ "$KEY" = "ports" ] && PORTSTEST="1"
		done
	json_select ..
json_select ..
LANTEST=$(uci get network.brlan_dev.ports)

if [ -n "$PORTSTEST" ]; then
	# DSA
	json_select network
		json_select lan
			json_select ports
				json_get_keys PORTS
				[ -n "$PORTS" ] || exit 0
				for PORT in $PORTS; do
					json_get_var PORTNAME $PORT
					STATUS=$(get_status_speed "$PORTNAME")
					VLANMEMBERSHIP=$(get_vlan_membership "$PORTNAME" | tr '\n' ' ' | sed 's/ *$//')
					echo "ports.push([\"LAN${PORTNAME:3}\",\"$STATUS\",\"$VLANMEMBERSHIP\"]);"
				done
			json_select ..
		json_select ..
	json_select ..
elif [ -n "$SWITCHTEST" ]; then
	# swconfig
	[ -e /sbin/swconfig ] || exit 0
	json_select switch
		json_get_keys SWITCHKEYS
		#handle only a single switch for now
		SWITCHID=$(echo $SWITCHKEYS | grep "switch" | cut -d " " -f1)
		[ -n "$SWITCHID" ] || exit 0

		json_select $SWITCHID
			json_select ports
				json_get_keys PORTS
				[ -n "$PORTS" ] || exit 0

				IFLAN=$(awk '/default_lan_if/ {print $2}' /etc/gargoyle_default_ifs)
				VLAN=$(echo $IFLAN | cut -f2 -d.)
				[ "$VLAN" = "$IFLAN" ] && VLAN=""

				for PORT in $PORTS; do
					json_select $PORT
						json_get_var PHYSICAL index
						json_get_var LOGICAL num
						json_get_var ROLE role
					json_select ..
					if [ "$ROLE" = "lan" ] && [ -n "$LOGICAL" ] ; then
						[ "$P" = "-1" ] && continue
						[ -n "$VLAN" ] && {
							PVID=$(swconfig dev $SWITCHID port $LOGICAL get pvid)
							[ "$PVID" != "$VLAN" ] && continue
						}
						LINK=$(swconfig dev switch0 port $LOGICAL get link | cut -f2,3 -d" ")
						STATUS=$(convert_link_speed "$LINK")
						echo "ports.push([\"LAN$PHYSICAL\",\"$STATUS\"]);"
					fi
				done
			json_select ..
		json_select ..
	json_select ..
elif [ -n "$LANTEST" ]; then
	# Try just using ethX
	lan_eths=$(uci get network.brlan_dev.ports)
	for PORTNAME in $lan_eths; do
		STATUS=$(get_status_speed "$PORTNAME")
		echo "ports.push([\"LAN${PORTNAME:3}\",\"$STATUS\"]);"
	done
fi

exit 0
