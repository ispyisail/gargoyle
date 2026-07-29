#!/bin/sh
# generate_diagnostic_report.sh -- redacted router-state dump for forum/
# GitHub support requests. Read-only: no uci set, nft add/delete, or
# sysctl -w anywhere in this script.
#
# Usage: sh generate_diagnostic_report.sh [standard|relaxed]
#   standard (default) -- maximum redaction, safe for posting publicly.
#   relaxed             -- for sharing privately with someone you trust.
#                           Relaxes a small set of low-sensitivity, non-
#                           locating fields (see REDACT_RELAXED_FIELDS
#                           below). Credentials and anything that could
#                           physically locate the router are NEVER relaxed,
#                           in either mode -- that list is fixed, not a
#                           default the caller can override.

LEVEL="${1:-standard}"

# --- redaction ---------------------------------------------------------
#
# Field-name lists below were checked against every option name actually
# used across this tree's own www/js sources before being added here, not
# just assumed safe from the name alone -- notably: "domain" is NOT a safe
# global redaction target, because dhcp's own "option domain" (the LAN's
# local search domain, e.g. "home.arpa") is a completely different,
# non-sensitive field from ddns_gargoyle's "option domain" (the actual
# public DDNS hostname). Redacting it globally would blank a boring default
# on every router's dhcp section for no privacy benefit, and would reduce
# the report's diagnostic value for anyone genuinely troubleshooting DNS.
# domain/service_provider are therefore redacted only within the
# ddns_gargoyle package's own export block (see the per-package loop below),
# not via the global patterns everything else uses.
#
# Everything else in these lists was confirmed to appear under exactly one
# package's option namespace in this tree (or, for "remote", to legitimately
# apply to more than one VPN plugin's own remote-endpoint option, which is
# exactly the locating information this is meant to catch).

REDACT_ALWAYS_FIELDS="private_key|preshared_key|password|admin_password|key_passphrase|wps_pin|key|ssid|remote|endpoint_host|dest_port|dest_ip"
REDACT_RELAXED_FIELDS="public_key|dns|server|timezone|workgroup|encryption"
REDACT_DDNS_FIELDS="domain|service_provider"

# uci export / /etc/config file syntax is whitespace-separated
# ("option private_key 'value'"), not key=value.
redact_uci_always()
{
	sed -E "s/((option|list)[[:space:]]+(${REDACT_ALWAYS_FIELDS})[[:space:]]+)'?[^'\"[:space:]]+'?/\1<REDACTED>/g"
}
redact_uci_relaxed_fields()
{
	sed -E "s/((option|list)[[:space:]]+(${REDACT_RELAXED_FIELDS})[[:space:]]+)'?[^'\"[:space:]]+'?/\1<REDACTED>/g"
}
redact_ddns_fields()
{
	sed -E "s/((option|list)[[:space:]]+(${REDACT_DDNS_FIELDS})[[:space:]]+)'?[^'\"[:space:]]+'?/\1<REDACTED>/g"
}
redact_wg_show()
{
	# wg show never prints private keys itself (only `wg show <if>
	# private-key` does, which this script never calls) -- only the
	# preshared key needs catching here.
	sed -E "s/(preshared key: ?)[A-Za-z0-9+\/=]+/\1<REDACTED>/g"
}
redact_mac()
{
	sed -E "s/([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}/<MAC-REDACTED>/g"
}
# Redacts the actual destination of a port forward wherever the compiled
# nftables ruleset states one (dnat/snat "... ip to <ip>[:<port>]") --
# targeted at the NAT syntax itself rather than a specific chain name, so it
# doesn't depend on knowing every chain Gargoyle might generate. This is
# the one thing that stays redacted in BOTH tiers, no exceptions: it's
# about attack-surface exposure (what's reachable from the WAN, and where
# it actually goes), not identity correlation, so "sharing privately with
# someone you trust" is never a reason to relax it -- if a specific
# forward's destination needs to be shared, that's a direct conversation,
# not something this report should carry either way.
redact_portforward_targets()
{
	sed -E "s/(dnat ip to |snat ip to )[0-9]{1,3}(\.[0-9]{1,3}){3}(:[0-9]+)?/\1<REDACTED>/g"
}

redact_pkg()
{
	# $1 = uci package name being redacted, read from stdin
	_pkg="$1"
	_out="$(cat | redact_uci_always | redact_mac)"
	if [ "$_pkg" = "ddns_gargoyle" ] ; then
		_out="$(echo "$_out" | redact_ddns_fields)"
	fi
	if [ "$LEVEL" != "relaxed" ] ; then
		_out="$(echo "$_out" | redact_uci_relaxed_fields)"
	fi
	echo "$_out"
}

section() { echo; echo "===== $1 ====="; }

echo "Gargoyle diagnostic report -- redaction level: $LEVEL"
echo "(read-only: no uci set, nft add/delete, or sysctl -w anywhere in this script)"

# --- 1. identity ---------------------------------------------------------
section "Router identity"
cat /etc/banner 2>/dev/null
echo "--- board ---"
if command -v ubus >/dev/null 2>&1; then
	ubus call system board 2>/dev/null
else
	cat /tmp/sysinfo/board_name 2>/dev/null
fi
echo "--- kernel ---"
uname -a

# --- 2. network state ------------------------------------------------------
section "rp_filter (reverse-path filtering -- strict mode can silently drop
a forwarded packet whose path doesn't look reversible to the kernel; worth
checking on any LAN/WAN or VPN forwarding issue)"
for f in \
	/proc/sys/net/ipv4/conf/all/rp_filter \
	/proc/sys/net/ipv4/conf/default/rp_filter \
	/proc/sys/net/ipv4/conf/br-lan/rp_filter \
; do
	if [ -f "$f" ]; then
		printf "%-45s %s\n" "$f" "$(cat "$f")"
	fi
done
for f in /proc/sys/net/ipv4/conf/*/rp_filter ; do
	case "$f" in
		*/all/rp_filter|*/default/rp_filter|*/br-lan/rp_filter) continue ;;
	esac
	[ -f "$f" ] && printf "%-45s %s\n" "$f" "$(cat "$f")"
done

section "ip_forward"
cat /proc/sys/net/ipv4/ip_forward 2>/dev/null

if command -v wg >/dev/null 2>&1; then
	section "WireGuard interfaces + peers"
	if wg show all 2>/dev/null | grep -q . ; then
		wg show all | redact_wg_show
	else
		echo "(wg show empty -- no interface up)"
	fi
fi

section "Routes"
ip route show
echo "--- ipv6 ---"
ip -6 route show 2>/dev/null

section "Addresses"
ip -br addr show 2>/dev/null | redact_mac

section "nftables ruleset (full)"
nft list ruleset 2>/dev/null | redact_mac | redact_portforward_targets

# --- 3. uci config export, every installed package --------------------------
section "uci config export (every package in /etc/config)"
for cfg in /etc/config/* ; do
	[ -f "$cfg" ] || continue
	pkg=$(basename "$cfg")
	echo
	echo "--- uci export $pkg ---"
	uci export "$pkg" 2>/dev/null | redact_pkg "$pkg"
done

echo
echo "===== done ====="
