#!/bin/sh
# Shared library for the Gargoyle settings-profile system (RFC #97).
#
# Sourced by gargoyle_profile.sh (the orchestrator) and by every
# profile.d/NN-*.sh part. Provides two things:
#   1. the import-report accumulator (the "warnings" surface)
#   2. board.json capability queries (the cross-hardware oracle)
#
# The caller must have sourced /usr/share/libubox/jshn.sh before calling any
# function here that builds or reads JSON. The parts and the orchestrator all
# do. This file writes no JSON of its own except in profile_report_flush.

# --- import report -------------------------------------------------------
#
# The report accumulates across separate part *processes* (the orchestrator
# runs each part as its own `sh part import`), so it can't live in shell
# memory -- it lives in a file whose path the orchestrator exports as
# PROFILE_REPORT_TMP. Each line is tab-separated:
#     feature <TAB> field <TAB> outcome <TAB> reason
# Tabs/newlines in the reason are squeezed to spaces so the format stays
# unambiguous. profile_report_flush turns the whole thing into JSON.

_PROFILE_TAB=$(printf '\t')

profile_report_init()
{
	: > "$PROFILE_REPORT_TMP"
}

profile_report_add()
{
	# <feature> <field> <outcome> [reason...]
	# outcome must be one of: applied | adapted | deferred | dropped
	_pr_feature="$1"
	_pr_field="$2"
	_pr_outcome="$3"
	shift 3
	_pr_reason="$*"
	case "$_pr_outcome" in
		applied|adapted|deferred|dropped)
			;;
		*)
			_pr_reason="INVALID OUTCOME '$_pr_outcome': $_pr_reason"
			_pr_outcome="dropped"
			;;
	esac
	_pr_reason=$(printf '%s' "$_pr_reason" | tr '\t\n' '  ')
	printf '%s\t%s\t%s\t%s\n' "$_pr_feature" "$_pr_field" "$_pr_outcome" "$_pr_reason" >> "$PROFILE_REPORT_TMP"
}

profile_report_flush()
{
	# <outfile> : convert the TSV accumulator to import-report.json
	_pr_out="$1"
	_pr_applied=0
	_pr_adapted=0
	_pr_deferred=0
	_pr_dropped=0
	json_init
	json_add_int schema 1
	json_add_string generated "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	json_add_array entries
	if [ -f "$PROFILE_REPORT_TMP" ] ; then
		while IFS="$_PROFILE_TAB" read -r _pr_f _pr_fl _pr_o _pr_r ; do
			[ -n "$_pr_f" ] || continue
			json_add_object
			json_add_string feature "$_pr_f"
			json_add_string field "$_pr_fl"
			json_add_string outcome "$_pr_o"
			json_add_string reason "$_pr_r"
			json_close_object
			case "$_pr_o" in
				applied)  _pr_applied=$(( _pr_applied + 1 )) ;;
				adapted)  _pr_adapted=$(( _pr_adapted + 1 )) ;;
				deferred) _pr_deferred=$(( _pr_deferred + 1 )) ;;
				dropped)  _pr_dropped=$(( _pr_dropped + 1 )) ;;
			esac
		done < "$PROFILE_REPORT_TMP"
	fi
	json_close_array
	json_add_object summary
	json_add_int applied  "$_pr_applied"
	json_add_int adapted  "$_pr_adapted"
	json_add_int deferred "$_pr_deferred"
	json_add_int dropped  "$_pr_dropped"
	json_close_object
	json_dump > "$_pr_out"
}

# --- board.json capability oracle ---------------------------------------
#
# Pure reads of the target's own /etc/board.json, using the same jshn idiom
# switchinfo.sh already uses. Each query reloads board.json into the jshn
# namespace so it never depends on a caller's cursor state. This first cut
# covers the wlan (Tier 3) queries -- rich, testable capability data present
# on every radio-bearing board. The Tier 2 port queries (cap_lan_port_count,
# cap_port_role_exists) land with the 20-lan part, which gives them a real
# consumer and DSA test data.

_cap_load_board()
{
	[ -e /etc/board.json ] || return 1
	json_load_file /etc/board.json 2>/dev/null
}

# Uppercase a band token (2g -> 2G) to match board.json's key casing.
# NOTE: must use a-z/A-Z, NOT tr's [:lower:]/[:upper:] classes -- this
# image's busybox tr silently leaves [:lower:]/[:upper:] untouched (verified
# live), which would make every capability query miss. shellcheck SC2018/9
# flag a-z here; that advisory is wrong for busybox and is intentionally
# ignored.
_cap_upper()
{
	printf '%s' "$1" | tr a-z A-Z
}

# cap_band_supported <2g|5g|6g> -> prints 1 if any radio advertises the band
cap_band_supported()
{
	_cap_band=$(_cap_upper "$1")
	_cap_found=0
	if _cap_load_board && json_is_a wlan object ; then
		json_select wlan
		json_get_keys _cap_phys
		for _cap_phy in $_cap_phys ; do
			json_select "$_cap_phy"
			if json_is_a info object ; then
				json_select info
				if json_is_a bands object ; then
					json_select bands
					if json_is_a "$_cap_band" object ; then
						_cap_found=1
					fi
					json_select ..
				fi
				json_select ..
			fi
			json_select ..
		done
		json_select ..
	fi
	echo "$_cap_found"
}

# cap_max_width_for <2g|5g|6g> -> prints the largest max_width (MHz) any radio
# advertises for that band, or 0 if the band is unsupported
cap_max_width_for()
{
	_cap_band=$(_cap_upper "$1")
	_cap_max=0
	if _cap_load_board && json_is_a wlan object ; then
		json_select wlan
		json_get_keys _cap_phys
		for _cap_phy in $_cap_phys ; do
			json_select "$_cap_phy"
			if json_is_a info object ; then
				json_select info
				if json_is_a bands object ; then
					json_select bands
					if json_is_a "$_cap_band" object ; then
						json_select "$_cap_band"
						_cap_w=""
						json_get_var _cap_w max_width
						if [ -n "$_cap_w" ] && [ "$_cap_w" -gt "$_cap_max" ] 2>/dev/null ; then
							_cap_max="$_cap_w"
						fi
						json_select ..
					fi
					json_select ..
				fi
				json_select ..
			fi
			json_select ..
		done
		json_select ..
	fi
	echo "$_cap_max"
}

# cap_mode_supported <2g|5g|6g> <MODE> -> prints 1 if any radio lists MODE
# (e.g. HE160, VHT80) in that band's modes[] array
cap_mode_supported()
{
	_cap_band=$(_cap_upper "$1")
	_cap_mode="$2"
	_cap_found=0
	if _cap_load_board && json_is_a wlan object ; then
		json_select wlan
		json_get_keys _cap_phys
		for _cap_phy in $_cap_phys ; do
			json_select "$_cap_phy"
			if json_is_a info object ; then
				json_select info
				if json_is_a bands object ; then
					json_select bands
					if json_is_a "$_cap_band" object ; then
						json_select "$_cap_band"
						if json_is_a modes array ; then
							json_select modes
							json_get_values _cap_modes
							for _cap_m in $_cap_modes ; do
								[ "$_cap_m" = "$_cap_mode" ] && _cap_found=1
							done
							json_select ..
						fi
						json_select ..
					fi
					json_select ..
				fi
				json_select ..
			fi
			json_select ..
		done
		json_select ..
	fi
	echo "$_cap_found"
}

# cap_wpa3_supported -> 1 if this image can run WPA3-Personal (SAE) as an AP.
# SAE needs a full wpad/hostapd crypto build (mbedtls/openssl/wolfssl); the
# size-optimised wpad-basic* / wpad-mini variants omit it. This is not a
# board.json fact (encryption is a software capability, not a radio one), so
# it reads the installed wpad package variant. Conservative default (0) when
# nothing is detected.
cap_wpa3_supported()
{
	_cap_wpad=$(opkg list-installed 2>/dev/null | grep '^wpad' | head -1 | awk '{print $1}')
	case "$_cap_wpad" in
		*basic*|*mini*) echo 0 ;;
		"")             echo 0 ;;
		*)              echo 1 ;;
	esac
}

# cap_lan_ports -> space-separated list of the target's DSA LAN switch port
# roles from board.json (network.lan.ports), e.g. "lan1 lan2 lan3 lan4".
# Empty when the board has no switch-port array (non-DSA / single-LAN devices).
# This is the same board.json field vlan.sh gates the whole VLAN Manager on.
cap_lan_ports()
{
	_cap_ports=""
	if _cap_load_board && json_is_a network object ; then
		json_select network
		if json_is_a lan object ; then
			json_select lan
			if json_is_a ports array ; then
				json_select ports
				json_get_values _cap_pv
				_cap_ports="$_cap_pv"
				json_select ..
			fi
			json_select ..
		fi
		json_select ..
	fi
	echo "$_cap_ports"
}

# cap_lan_port_count -> number of DSA LAN switch ports (0 if none).
cap_lan_port_count()
{
	_cap_n=0
	for _cap_p in $(cap_lan_ports) ; do _cap_n=$(( _cap_n + 1 )) ; done
	echo "$_cap_n"
}

# cap_port_role_exists <name> -> 1 if <name> is a LAN port on this board.
cap_port_role_exists()
{
	_cap_want="$1"
	for _cap_p in $(cap_lan_ports) ; do
		[ "$_cap_p" = "$_cap_want" ] && { echo 1 ; return ; }
	done
	echo 0
}
