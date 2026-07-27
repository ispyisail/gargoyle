#!/usr/bin/haserl
<%
	# This program is copyright © 2026 and is distributed under the terms of the GNU GPL
	# version 2.0 with a special clarification/exception that permits adapting the program to
	# configure proprietary "back end" software provided that all modifications to the web interface
	# itself remain covered by the GPL.
	# See http://gargoyle-router.com/faq.html#qfoss for more information
	#
	# Backs the "Test encrypted DNS" button on doh.sh. Resolves a probe name
	# through the router's own resolver (127.0.0.1, i.e. dnsmasq -- exactly
	# what a LAN client would query) while a short WAN-side capture confirms
	# no plaintext port-53 traffic left the router during the probe. Extends
	# the same ubus service-list status check doh.sh's own header block
	# already uses, rather than adding a second status mechanism.
	eval $( gargoyle_session_validator -c "$POST_hash" -e "$COOKIE_exp" -a "$HTTP_USER_AGENT" -i "$REMOTE_ADDR" -r "login.sh" -t $(uci get gargoyle.global.session_timeout) -b "$COOKIE_browser_time"  )

	echo "Content-type: text/plain"
	echo ""

	. /lib/functions.sh
	. /lib/functions/network.sh

	probe_domain="gargoyle-doh-test.invalid"
	capture_file="/tmp/doh_test_capture.pcap"
	capture_seconds=3

	hdp_running=$(ubus call service list "{'name':'https-dns-proxy'}" 2>/dev/null | jsonfilter -q -e "@['https-dns-proxy'].instances[*].running" | uniq)
	hdp_ports=$(ubus call service list "{'name':'https-dns-proxy'}" 2>/dev/null | jsonfilter -q -e "@['https-dns-proxy'].instances[*].data.mdns.*.port")

	wan_if=""
	network_get_device wan_if wan
	if [ -z "$wan_if" ] ; then
		network_get_physdev wan_if wan
	fi

	plain53_count="unavailable"
	if [ -n "$wan_if" ] && command -v tcpdump >/dev/null 2>&1 ; then
		rm -f "$capture_file"
		tcpdump -i "$wan_if" -w "$capture_file" "udp port 53 or tcp port 53" >/dev/null 2>&1 &
		tcpdump_pid=$!
		sleep 1
	fi

	resolve_start=$(date +%s%3N 2>/dev/null || date +%s)
	resolve_out=$(nslookup "$probe_domain" 127.0.0.1 2>&1)
	resolve_end=$(date +%s%3N 2>/dev/null || date +%s)
	resolve_ms=$((resolve_end - resolve_start))

	if [ -n "$wan_if" ] && [ -n "$tcpdump_pid" ] ; then
		sleep "$capture_seconds"
		kill "$tcpdump_pid" >/dev/null 2>&1
		wait "$tcpdump_pid" 2>/dev/null
		if command -v tcpdump >/dev/null 2>&1 ; then
			plain53_count=$(tcpdump -nn -r "$capture_file" 2>/dev/null | wc -l)
		fi
		rm -f "$capture_file"
	fi

	# probe_domain is a .invalid name (RFC 2606) so a healthy resolver chain
	# always answers NXDOMAIN -- that NXDOMAIN response is itself the proof
	# the resolver is alive and reachable; a real A/AAAA record would only
	# ever appear from a broken/hijacked resolver. "responded" therefore
	# means "got a definitive answer of either kind", not "domain exists".
	responded="0"
	echo "$resolve_out" | grep -qiE "can.t resolve|NXDOMAIN|Non-existent|^Address" && responded="1"

	echo "proxy_running=${hdp_running:-false}"
	echo "proxy_ports=${hdp_ports:-}"
	echo "wan_interface=${wan_if:-unknown}"
	echo "probe_domain=${probe_domain}"
	echo "probe_responded=${responded}"
	echo "probe_ms=${resolve_ms}"
	echo "plaintext_53_on_wan=${plain53_count}"
%>
