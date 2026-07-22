#!/bin/sh
# Settings-profile part: wifi (RFC #97) -- the Tier-3 capability hook.
# Destination: /usr/lib/gargoyle/profile.d/30-wifi.sh
#
# This is the first part that exercises the adapt/drop path rather than pure
# Tier-1 applies. Each AP is captured hardware-free, keyed by BAND (2g/5g/6g)
# rather than by radio device name, so it can land on a different router:
#
#   Tier 1 within wifi (always applied): ssid, key, hidden
#   Tier 3 (capability-gated, may adapt/drop):
#     - band    : if no radio for that band exists, remap to the best
#                 available band (adapted) or drop the AP (dropped)
#     - htmode  : channel width clamped to the radio's board.json max (adapted)
#     - encrypt : WPA3/SAE downgraded to WPA2/PSK2 if the image lacks SAE
#                 (adapted) -- the SSID and key still land
#
# The width/band capability facts come from board.json (cap_* in
# profile_lib.sh); the SAE fact from the wpad variant (cap_wpa3_supported).
# The pure resolve helpers below take those facts as arguments so they are
# unit-testable with every combination, and the importer feeds them the real
# live values.

[ -e /usr/share/libubox/jshn.sh ] || exit 0
. /usr/share/libubox/jshn.sh
[ -e /usr/lib/gargoyle/profile_lib.sh ] && . /usr/lib/gargoyle/profile_lib.sh

# --- pure helpers (no I/O; unit-tested directly) ------------------------

# wifi_width_of_htmode <htmode> -> channel width in MHz (0 if unknown/none)
# HT20->20, VHT80->80, HE160->160, VHT80P80->160 (80+80), NONE/""->20
wifi_width_of_htmode()
{
	case "$1" in
		""|NONE|HT20|VHT20|HE20|EHT20) echo 20 ;;
		*80P80)                        echo 160 ;;
		*)
			# trailing digits
			_w=$(printf '%s' "$1" | sed 's/[^0-9]*//;s/[^0-9].*$//')
			case "$_w" in
				20|40|80|160|320) echo "$_w" ;;
				*)                echo 20 ;;
			esac
			;;
	esac
}

# wifi_htmode_prefix <htmode> -> the mode family without the width
# HE160->HE, VHT80P80->VHT, HT40->HT
wifi_htmode_prefix()
{
	printf '%s' "$1" | sed 's/[0-9P]*$//'
}

# wifi_clamp_htmode <htmode> <max_mhz> -> htmode clamped to max width.
# Keeps the mode family (HE stays HE), only reduces the width number.
wifi_clamp_htmode()
{
	_htm="$1"
	_max="$2"
	[ -n "$_max" ] && [ "$_max" -gt 0 ] 2>/dev/null || { echo "$_htm"; return; }
	_w=$(wifi_width_of_htmode "$_htm")
	if [ "$_w" -le "$_max" ] 2>/dev/null ; then
		echo "$_htm"
	else
		_pfx=$(wifi_htmode_prefix "$_htm")
		echo "${_pfx}${_max}"
	fi
}

# wifi_resolve_encryption <encryption> <wpa3_ok> -> encryption to actually use.
# When the image can't do SAE, WPA3 modes fall back to WPA2-PSK; everything
# else (psk2, psk-mixed, none, ...) passes through unchanged.
wifi_resolve_encryption()
{
	_enc="$1"
	_wpa3="$2"
	case "$_enc" in
		sae|sae-mixed|owe)
			if [ "$_wpa3" = "1" ] ; then
				echo "$_enc"
			else
				echo "psk2"
			fi
			;;
		*)
			echo "$_enc"
			;;
	esac
}

# --- live lookups (read current wireless UCI) ---------------------------

# wifi_device_for_band <band> -> the wifi-device section whose band matches,
# or empty. This is the band->radio role mapping: the fresh-flashed router's
# own wifi-device sections are its rendering of board.json's radios.
wifi_device_for_band()
{
	_want="$1"
	uci show wireless 2>/dev/null | grep '=wifi-device' | cut -d= -f1 | cut -d. -f2 | while read -r _d ; do
		_b=$(uci -q get "wireless.${_d}.band")
		if [ "$_b" = "$_want" ] ; then
			echo "$_d"
			return
		fi
	done
}

# wifi_best_free_band <claimed> -> the highest-capability band (6g>5g>2g)
# whose radio's AP interface is NOT already in the space-separated <claimed>
# list. Empty if every radio is taken or the router has none. This is what
# makes a band remap avoid clobbering a radio another AP legitimately claimed.
wifi_best_free_band()
{
	_claimed=" $1 "
	for _b in 6g 5g 2g ; do
		_bd=$(wifi_device_for_band "$_b")
		[ -n "$_bd" ] || continue
		_bi=$(wifi_ap_iface_for_device "$_bd")
		[ -n "$_bi" ] || continue
		case "$_claimed" in
			*" $_bi "*) continue ;;
		esac
		echo "$_b"
		return
	done
}

# wifi_ap_iface_for_device <device> -> the AP wifi-iface bound to it (mode=ap),
# or empty.
wifi_ap_iface_for_device()
{
	_dev="$1"
	uci show wireless 2>/dev/null | grep '=wifi-iface' | cut -d= -f1 | cut -d. -f2 | while read -r _i ; do
		[ "$(uci -q get "wireless.${_i}.device")" = "$_dev" ] || continue
		_m=$(uci -q get "wireless.${_i}.mode")
		if [ -z "$_m" ] || [ "$_m" = "ap" ] ; then
			echo "$_i"
			return
		fi
	done
}

# --- export -------------------------------------------------------------

wifi_export()
{
	# Collect device sections FIRST, into a variable. A `... | while read`
	# pipeline runs the loop body in a subshell, so json_add_* mutations
	# inside it would be discarded and the array would come out empty --
	# iterate a plain list in the current shell instead. (Section names are
	# whitespace-free, so word-splitting on $_devs is safe.)
	_devs=$(uci show wireless 2>/dev/null | grep '=wifi-device' | cut -d= -f1 | cut -d. -f2)
	json_init
	json_add_array wifi
	for _dev in $_devs ; do
		_band=$(uci -q get "wireless.${_dev}.band")
		[ -n "$_band" ] || continue
		_iface=$(wifi_ap_iface_for_device "$_dev")
		[ -n "$_iface" ] || continue
		_ssid=$(uci -q get "wireless.${_iface}.ssid")
		[ -n "$_ssid" ] || continue
		_enc=$(uci -q get "wireless.${_iface}.encryption")
		_key=$(uci -q get "wireless.${_iface}.key")
		_hidden=$(uci -q get "wireless.${_iface}.hidden")
		_htmode=$(uci -q get "wireless.${_dev}.htmode")
		json_add_object
		json_add_string band "$_band"
		json_add_string ssid "$_ssid"
		json_add_string encryption "${_enc:-none}"
		json_add_string key "$_key"
		json_add_string hidden "${_hidden:-0}"
		json_add_string htmode "$_htmode"
		json_close_object
	done
	json_close_array
	json_dump
}

# --- import -------------------------------------------------------------

wifi_import_entry()
{
	# reads the currently-selected wifi array element; applies it
	_band=""; _ssid=""; _enc=""; _key=""; _hidden=""; _htmode=""
	json_get_var _band band
	json_get_var _ssid ssid
	json_get_var _enc encryption
	json_get_var _key key
	json_get_var _hidden hidden
	json_get_var _htmode htmode
	[ -n "$_ssid" ] || return 0

	_field="wifi.${_band}.${_ssid}"

	# --- band resolution (collision-aware) -------------------------------
	# Exact band if its radio exists and its AP isn't already claimed by an
	# earlier entry this run; otherwise remap to the best still-free band.
	_dev=$(wifi_device_for_band "$_band")
	_useband="$_band"
	_band_adapted=0
	_iface=""
	if [ -n "$_dev" ] ; then
		_iface=$(wifi_ap_iface_for_device "$_dev")
		case " $_wifi_claimed " in
			*" $_iface "*) _dev="" ; _iface="" ;;   # already taken -> remap
		esac
	fi
	if [ -z "$_iface" ] ; then
		_alt=$(wifi_best_free_band "$_wifi_claimed")
		if [ -z "$_alt" ] ; then
			profile_report_add wifi "$_field" dropped "no free wifi radio for band $_band"
			return 0
		fi
		_dev=$(wifi_device_for_band "$_alt")
		_iface=$(wifi_ap_iface_for_device "$_dev")
		[ "$_alt" != "$_band" ] && _band_adapted=1
		_useband="$_alt"
	fi
	if [ -z "$_iface" ] ; then
		profile_report_add wifi "$_field" dropped "no AP interface on the target radio"
		return 0
	fi
	_wifi_claimed="$_wifi_claimed $_iface"

	# --- Tier 1: ssid / key / hidden always land -------------------------
	uci set "wireless.${_iface}.ssid=$_ssid"
	uci set "wireless.${_iface}.hidden=${_hidden:-0}"

	# --- Tier 3: encryption (WPA3 -> WPA2 if unsupported) ----------------
	_wpa3=$(cap_wpa3_supported)
	_useenc=$(wifi_resolve_encryption "$_enc" "$_wpa3")
	uci set "wireless.${_iface}.encryption=$_useenc"
	if [ "$_useenc" != "none" ] && [ -n "$_key" ] ; then
		uci set "wireless.${_iface}.key=$_key"
	fi

	# --- Tier 3: htmode width clamp --------------------------------------
	if [ -n "$_htmode" ] ; then
		_max=$(cap_max_width_for "$_useband")
		_usehtm=$(wifi_clamp_htmode "$_htmode" "$_max")
		uci set "wireless.${_dev}.htmode=$_usehtm"
	else
		_usehtm=""
	fi

	# --- classify the outcome for the report -----------------------------
	if [ "$_band_adapted" = "1" ] ; then
		profile_report_add wifi "$_field" adapted "band $_band unavailable; moved to $_useband"
	fi
	if [ "$_useenc" != "$_enc" ] ; then
		profile_report_add wifi "$_field" adapted "WPA3/SAE unavailable; using $_useenc"
	fi
	if [ -n "$_htmode" ] && [ "$_usehtm" != "$_htmode" ] ; then
		profile_report_add wifi "$_field" adapted "width $_htmode exceeds radio max; using $_usehtm"
	fi
	if [ "$_band_adapted" = "0" ] && [ "$_useenc" = "$_enc" ] && { [ -z "$_htmode" ] || [ "$_usehtm" = "$_htmode" ]; } ; then
		profile_report_add wifi "$_field" applied ""
	fi
}

wifi_import()
{
	_prof="$1"
	[ -f "$_prof" ] || return 1
	json_init
	json_load_file "$_prof" 2>/dev/null || return 1
	json_is_a wifi array || return 0     # no wifi in this profile, not an error
	_wifi_claimed=""                     # AP ifaces written this run (collision guard)
	json_select wifi
	json_get_keys _idx
	for _i in $_idx ; do
		json_select "$_i"
		wifi_import_entry
		json_select ..
	done
	json_select ..
}

# Dispatch only when executed directly (sh 30-wifi.sh export|import). Guarding
# on $0 lets a unit test `. 30-wifi.sh` to reach the pure helpers without the
# usage branch aborting the sourcing shell.
case "$0" in
	*/30-wifi.sh|30-wifi.sh)
		case "$1" in
			export)
				wifi_export
				;;
			import)
				wifi_import "$2"
				;;
			*)
				echo "Usage: $0 export|import [profile]" >&2
				exit 1
				;;
		esac
		;;
esac
