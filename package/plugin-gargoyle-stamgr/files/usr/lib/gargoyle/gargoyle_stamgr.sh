#!/bin/sh

. /lib/functions.sh
. /usr/share/libubox/jshn.sh

DEBUG=0

pkgname="gargoyle_stamgr"
stacfgsec="stacfg"
cENABLED="0"
cDISABLED="1"
status_file="/tmp/gargoyle_stamgr.json"

max_retry=3
max_wait=45
blacklist_timer=600
disconnect_quality_threshold=50
connect_quality_threshold=70

log_print()
{
	local priority="$1" msg="$2"
	
	if [ "$priority" != "DEBUG" ] || [ "$DEBUG" = "1" ] ; then
		logger -p "$priority" -t "Gargoyle STA Manager" "$msg"
	fi
}

find_wireless_stacfg()
{
	[ "$(uci_get "wireless" "$stacfgsec" "mode")" = "sta" ] || return 1
	return 0
}

load_vars()
{
	config_cb()
	{
		local type="$1" name="$2"
		log_print "DEBUG" "Loaded $name = $type"
		if [ "$name" = "global" ] && [ "$type" = "$pkgname" ] ; then
			option_cb()
			{
				local option="$1" value="$2"
				eval "$option=\"$value\""
				log_print "DEBUG" "Loaded $option = $value"
			}
		else
			option_cb()
			{
				return 0
			}
		fi
	}
	
	config_load $pkgname
	config_foreach load_sta_sections $stacfgsec
	
	log_print "INFO" "Loaded $(echo "$sta_sections" | wc -w) STA configs from gargoyle_stamgr"
	log_print "DEBUG" "STA section IDs: $sta_sections"
	
	identify_wlan_bands
	log_print "DEBUG" "2.4GHz radio: $band24. 5GHz radio: $band5"
	
	json_init
	
	return 0
}

load_sta_sections()
{
	local config="$1"
	if [ -z "${sta_sections}" ] ; then
		sta_sections="$config"
	else
		sta_sections="${sta_sections} ${config}"
	fi
}

identify_wlan_bands()
{
	local radios="radio0 radio1"
	for radio in $radios ; do
		hwmode="$(uci_get "wireless" "$radio" "band")"
		if [ "$hwmode" = "2g" ] ; then
			band24="$radio"
		elif [ "$hwmode" = "5g" ] ; then
			band5="$radio"
		fi
	done
}

set_wifi_iface()
{
	local section="$1" disabled="$2"
	uci set wireless."$1".disabled="$2"
	[ "$disabled" = "1" ] && log_print "INFO" "Disabled wireless config $section" || log_print "INFO" "Enabled wireless config $section"
}

get_stacfg_disabled()
{
	disabled="$(uci_get "wireless" "$stacfgsec" "disabled")"
	[ "$disabled" = "1" ] && return 0 || return 1
}

reload_wifi()
{
	log_print "DEBUG" "Reloading wifi..."
	wifi
	ubus wait_for network.wireless
}

check_sta()
{
	sta_radio="$(uci_get "wireless" "$stacfgsec" "device")"
	# Use the resolved phy name directly rather than stripping its digits and
	# re-substituting into "$sta_radio-sta0" - that only produced the right
	# interface name when the kernel's phy number happened to match the
	# radio's own UCI suffix (e.g. radio0 -> phy0), which isn't guaranteed
	# (driver/hotplug reordering, or repeated module reload as with
	# mac80211_hwsim in test environments). A mismatch here queries a
	# nonexistent interface, so check_sta always reports disconnected even
	# when the station has genuinely associated.
	phyname="$(iwinfo nl80211 phyname $sta_radio 2>&1)"
	if [ "$phyname" = "Phy not found" ] ; then
		sta_wlan="$(echo "$sta_radio-sta0" | sed 's/radio/phy/g' )"
	else
		sta_wlan="${phyname}-sta0"
	fi
	# `iwinfo <iface> info`'s ESSID field is stale under this OpenWrt base:
	# confirmed live that after a real, verified disconnect (`iw link`
	# correctly reports "Not connected.", and wpa_supplicant's own
	# `wpa_cli status` already shows wpa_state=SCANNING), iwinfo info kept
	# printing the last-associated ESSID unchanged for 150+ seconds, with
	# only Channel/Signal/Bit Rate degrading to unknown/0 -- and the old
	# "unknown" substring check below only ever inspected the ESSID and
	# Channel fields specifically, neither of which actually contains the
	# literal word "unknown" in this degraded-but-still-"connected"
	# state (Channel's degraded value prints as "0", not "unknown"), so
	# it never caught a real disconnect. Query wpa_supplicant's own
	# kernel-backed link state directly instead -- confirmed reliable in
	# both directions live (correctly flips to "Not connected." within
	# one poll of a genuine AP loss, and reports full signal detail
	# immediately on a fresh real association).
	link_info="$(iw dev "$sta_wlan" link 2>/dev/null)"
	if echo "$link_info" | grep -q "^Connected to" ; then
		sta_connected=true
		sta_dbm="$(echo "$link_info" | awk '/^[[:space:]]*signal:/ {print $2}')"
		sta_quality="$(awk -v dbm="${sta_dbm:--110}" 'BEGIN {
			q = dbm + 110
			if (q > 70) q = 70
			if (q < 0) q = 0
			printf "%i", q * 100 / 70
		}')"
	else
		sta_connected=false
		sta_quality=0
	fi
	sta_ssid="$(uci_get "wireless" "$stacfgsec" "ssid")"
	sta_bssid="$(uci_get "wireless" "$stacfgsec" "bssid")"
	sta_encryption="$(uci_get "wireless" "$stacfgsec" "encryption")"
	sta_password="$(uci_get "wireless" "$stacfgsec" "key")"
}

get_current_active_sta_section()
{
	local wireless_ssid wireless_bssid wireless_radio wireless_encryption wireless_password
	local stamgr_ssid stamgr_bssid stamgr_radio stamgr_encryption stamgr_password
	
	wireless_ssid="$(uci_get "wireless" "$stacfgsec" "ssid")"
	wireless_bssid="$(uci_get "wireless" "$stacfgsec" "bssid")"
	wireless_radio="$(uci_get "wireless" "$stacfgsec" "device")"
	wireless_encryption="$(uci_get "wireless" "$stacfgsec" "encryption")"
	wireless_password="$(uci_get "wireless" "$stacfgsec" "key")"
	
	active_sta_section=""
	for section in $sta_sections ; do
		stamgr_ssid="$(uci_get "$pkgname" "$section" "ssid")"
		stamgr_bssid="$(uci_get "$pkgname" "$section" "bssid")"
		stamgr_radio="$(uci_get "$pkgname" "$section" "radio")"
		stamgr_encryption="$(uci_get "$pkgname" "$section" "encryption")"
		stamgr_password="$(uci_get "$pkgname" "$section" "key")"
		if [ "$wireless_ssid" = "$stamgr_ssid" ] && [ "$wireless_bssid" = "$stamgr_bssid" ] && [ "$wireless_radio" = "$stamgr_radio" ] && [ "$wireless_encryption" = "$stamgr_encryption" ] && [ "$wireless_password" = "$stamgr_password" ] ; then
			active_sta_section="$section"
			break
		fi
	done
}

get_scan_results()
{
	local radios="radio0 radio1"
	local tmpif="stamgr-tmp0"
	scan_results=""
	for radio in $radios ; do
		# Use the resolved phy directly, same reasoning and same pattern as
		# check_sta(): UCI's own radio section name ("radio0") doesn't
		# reliably match the kernel's actual phy number.
		phyname="$(iwinfo nl80211 phyname $radio 2>&1)"
		[ "$phyname" = "Phy not found" ] && continue

		# `iwinfo <iface> scan` is broken outright under this OpenWrt base
		# (confirmed: fails with "Netlink error while awaiting scan
		# results: No event received" even on a real, already-up
		# interface). Separately, when the STA config's own real interface
		# exists, it's already owned by netifd's global wpa_supplicant
		# daemon, which refuses a second, externally-triggered scan on the
		# same vif ("Resource busy"). And when the STA config is
		# `disabled`, no kernel interface exists for it at all any more
		# (confirmed live: disabled=1 wifi-iface sections produce zero
		# interface under this netifd, unlike 24.10) -- there's nothing
		# for `iwinfo`/`iw` to scan against in the idle case either way.
		#
		# Work around all three by scanning through a short-lived,
		# daemon-independent interface created directly on the phy with
		# plain `iw`, instead of going through iwinfo or the STA config's
		# own interface. Verified this works identically whether the phy
		# is fully idle or already hosts a live, connected STA vif -- a
		# second vif on the same phy scans without disturbing the first's
		# association (mac80211/hwsim's own off-channel scan support, the
		# same mechanism a real STA's background roam-scan already relies
		# on; a phy already running an AP vif pays the same brief
		# beacon-interruption cost during the scan that any single-radio
		# AP+STA repeater setup already accepts today, not a new cost).
		# Interface name must stay under Linux's 15-char IFNAMSIZ limit.
		iw dev "$tmpif" del >/dev/null 2>&1
		iw phy "$phyname" interface add "$tmpif" type station >/dev/null 2>&1 || continue
		ip link set "$tmpif" up >/dev/null 2>&1
		sleep 1
		scan_list="$(iw dev "$tmpif" scan 2>/dev/null | awk -v radio="$radio" '
			function flush() {
				if (bssid != "") {
					enc = has_rsn ? "-" : "+"
					printf "%i,%s,\"%s\",%s,%s\n", quality, bssid, ssid, enc, radio
				}
			}
			BEGIN { bssid=""; ssid=""; quality=0; has_rsn=0 }
			/^BSS / {
				flush()
				bssid=$2; sub(/\(.*/, "", bssid)
				ssid=""; quality=0; has_rsn=0
			}
			/^\tsignal:/ {
				q = $2 + 110
				if (q > 70) q = 70
				if (q < 0) q = 0
				quality = int(q * 100 / 70)
			}
			/^\tSSID:/ {
				ssid=$0
				sub(/^\tSSID: /, "", ssid)
				gsub(/,/, ".", ssid)
			}
			/^\tRSN:/ || /^\tWPA:/ { has_rsn=1 }
			END { flush() }
		' | sort -rn)"
		iw dev "$tmpif" del >/dev/null 2>&1

		if [ -z "${scan_results}" ] ; then
			scan_results="$scan_list"
		else
			scan_results="${scan_results}
			${scan_list}"
		fi
	done
}

update_status_file()
{
	local blacklist_additions="$1"
	local now="$(date "+%s")"
	
	existing_blacklist_ids="$(json_dump | jsonfilter -e "@.station_blacklist[*].cfg_id")"
	existing_blacklist_times="$(json_dump | jsonfilter -e "@.station_blacklist[*].time")"

	log_print "DEBUG" "Updating status file"

	json_init
	json_add_int "lastUpdate" "$now"
	json_add_object "current_wireless_cfg"
		json_add_string "radio" "${sta_radio:--}"
		json_add_string "connected" "${sta_connected:--}"
		json_add_string "ssid" "${sta_ssid:--}"
		json_add_string "bssid" "${sta_bssid:--}"
		json_add_string "encryption" "${sta_encryption:--}"
	json_close_object
	json_add_string "active_cfg_id" "${active_sta_section:--}"
	json_add_array "station_blacklist"
		if [ -n "$existing_blacklist_ids" ] ; then
			count="$(echo "$existing_blacklist_ids" | wc -l)"
			for i in {1..$count} ; do
				local blacklist_id="$(echo "$existing_blacklist_ids" | head -n $count | tail -1)"
				local blacklist_time="$(echo "$existing_blacklist_times" | head -n $count | tail -1)"
				if [ "$((now - blacklist_time))" -le "$blacklist_timer" ] ; then
					json_add_object ""
						json_add_string "cfg_id" "$blacklist_id"
						json_add_int "time" "$blacklist_time"
					json_close_object
				else
					log_print "INFO" "Removing $blacklist_id from station_blacklist"
				fi
			done
		fi
		if [ -n "$blacklist_additions" ]; then
			for blacklist_addition in $blacklist_additions ; do
				json_add_object ""
					json_add_string "cfg_id" "$blacklist_addition"
					json_add_int "time" "$now"
				json_close_object
			done
		fi
	json_close_array
	json_dump > "$status_file"
}

swap_config()
{
	local stasec="$1"
	
	wireless_ssid="$(uci_get "$pkgname" "$stasec" "ssid")"
	wireless_bssid="$(uci_get "$pkgname" "$stasec" "bssid")"
	wireless_radio="$(uci_get "$pkgname" "$stasec" "radio")"
	wireless_encryption="$(uci_get "$pkgname" "$stasec" "encryption")"
	wireless_password="$(uci_get "$pkgname" "$stasec" "key")"
	
	uci delete wireless.$stacfgsec
	
	uci set wireless.$stacfgsec='wifi-iface'
	uci set wireless.$stacfgsec.mode='sta'
	uci set wireless.$stacfgsec.device="$wireless_radio"
	uci set wireless.$stacfgsec.network='wan'
	uci set wireless.$stacfgsec.ssid="$wireless_ssid"
	[ -n "$wireless_bssid" ] && uci set wireless.$stacfgsec.bssid="$wireless_bssid"
	uci set wireless.$stacfgsec.encryption="$wireless_encryption"
	[ "$wireless_encryption" != "none" ] && uci set wireless.$stacfgsec.key="$wireless_password"
}

main_loop()
{
	unset sta_connected sta_quality sta_ssid sta_bssid sta_radio sta_encryption sta_password
	check_sta
	log_print "DEBUG" "Current config - connected:$sta_connected;quality:$sta_quality;ssid:$sta_ssid;bssid:$sta_bssid;radio:$sta_radio;encryption:$sta_encryption;password:$sta_password;"
	get_current_active_sta_section
	sta_idx=1
	for sta_section in $sta_sections ; do
		[ "$active_sta_section" = "$sta_section" ] && { active_idx=$sta_idx; break; }
		sta_idx=$((sta_idx+1))
	done
	log_print "DEBUG" "Current config section - $active_sta_section"
	original_active_sta_section="$active_sta_section"
	update_status_file ""
	
	if [ "$sta_connected" = true ] ; then
		log_print "DEBUG" "Currently connected to $sta_ssid"
		disconnecting_from_current=false
		if [ "$sta_quality" -lt "$disconnect_quality_threshold" ] ; then
			log_print "INFO" "Connection quality ($sta_quality) less than threshold ($disconnect_quality_threshold). Disconnecting."
			set_wifi_iface $stacfgsec $cDISABLED
			uci commit wireless
			reload_wifi
			sleep 5
			disconnecting_from_current=true
		elif [ "$active_idx" = "1" ] ; then 
			log_print "DEBUG" "Highest priority connection still OK. Skipping."
		else
			get_scan_results
		
			if [ -n "$scan_results" ] ; then
				sta_idx="1"
				for sta_section in $sta_sections ; do
					blacklist_match="$(json_dump | jsonfilter -e "@.station_blacklist[@.cfg_id='$sta_section']")"
					[ -n "$blacklist_match" ] && { log_print "DEBUG" "Skipping blacklisted sta_section $sta_section."; sta_idx=$((sta_idx + 1 )); continue; }
					if [ "$sta_idx" -ge "$active_idx" ] && [ "$disconnecting_from_current" = false ] ; then
						log_print "DEBUG" "No better priority offers. Skipping."
						break
					fi
					local stamgr_ssid stamgr_bssid stamgr_radio
					stamgr_ssid="$(uci_get "$pkgname" "$sta_section" "ssid")"
					stamgr_bssid="$(uci_get "$pkgname" "$sta_section" "bssid")"
					stamgr_radio="$(uci_get "$pkgname" "$sta_section" "radio")"
					
					[ -z "$stamgr_ssid" ] && [ -z "$stamgr_bssid" ] && { log_print "DEBUG" "Missing minimum attributes in sta_section $sta_section. Skipping."; sta_idx=$((sta_idx + 1 )); continue; }
					
					[ -n "$stamgr_bssid" ] && bssid_rgx="$stamgr_bssid" || bssid_rgx=".*"
					[ -n "$stamgr_ssid" ] && ssid_rgx="\"$stamgr_ssid\"" || ssid_rgx=".*"
					[ -n "$stamgr_radio" ] && radio_rgx="$stamgr_radio" || radio_rgx=".*"
					
					regex_str="${bssid_rgx},${ssid_rgx},[\+-],${radio_rgx}\$"
					
					match="$(echo "$scan_results" | grep -m 1 $regex_str)"
					[ -z "$match" ] && { log_print "DEBUG" "sta_section $sta_section not found in scan. Skipping."; sta_idx=$((sta_idx + 1 )); continue; }
					scan_quality="$(echo "$match" | cut -d',' -f 1)"
					if [ "$scan_quality" -gt "$connect_quality_threshold" ] ; then
						log_print "DEBUG" "Found higher priority AP"
						attempts=1
						swap_config $sta_section
						set_wifi_iface $stacfgsec $cDISABLED
						uci commit wireless
						check_sta
						while [ "$attempts" -le "$max_retry" ]
						do
							log_print "INFO" "Connecting (attempt $attempts) to ssid:$sta_ssid;bssid:$sta_bssid;radio:$sta_radio;encryption:$sta_encryption;"
							set_wifi_iface $stacfgsec $cENABLED
							reload_wifi
							sleep $(( max_wait / max_retry ))
							unset sta_connected sta_quality sta_ssid sta_bssid sta_radio sta_encryption sta_password
							check_sta
							if [ "$sta_connected" = true ] ; then
								log_print "INFO" "Connected (attempt $attempts)"
								uci commit wireless
								get_current_active_sta_section
								break 2
							else
								if [ "$attempts" = "$max_retry" ] ; then
									log_print "INFO" "Failed (attempt $attempts). Too many attempts, blacklisting this connection for $blacklist_timer seconds"
									update_status_file "$sta_section"
								else
									log_print "DEBUG" "Failed (attempt $attempts). Sleeping and trying again..."
								fi
								uci revert wireless
								reload_wifi
								sleep 5
							fi
							attempts=$((attempts+1))
						done
					fi
					sta_idx=$((sta_idx+1))
				done
			else
				log_print "DEBUG" "No APs in range."
			fi
		fi
	else
		log_print "DEBUG" "Currently disconnected"
		get_stacfg_disabled || { set_wifi_iface $stacfgsec $cDISABLED; reload_wifi; sleep 5; }
		get_scan_results
		
		if [ -n "$scan_results" ] ; then
			for sta_section in $sta_sections ; do
				blacklist_match="$(json_dump | jsonfilter -e "@.station_blacklist[@.cfg_id='$sta_section']")"
				[ -n "$blacklist_match" ] && { log_print "DEBUG" "Skipping blacklisted sta_section $sta_section."; sta_idx=$((sta_idx + 1 )); continue; }
				local stamgr_ssid stamgr_bssid stamgr_radio
				stamgr_ssid="$(uci_get "$pkgname" "$sta_section" "ssid")"
				stamgr_bssid="$(uci_get "$pkgname" "$sta_section" "bssid")"
				stamgr_radio="$(uci_get "$pkgname" "$sta_section" "radio")"
				
				[ -z "$stamgr_ssid" ] && [ -z "$stamgr_bssid" ] && { log_print "DEBUG" "Missing minimum attributes in sta_section $sta_section. Skipping."; sta_idx=$((sta_idx + 1 )); continue; }
				
				[ -n "$stamgr_bssid" ] && bssid_rgx="$stamgr_bssid" || bssid_rgx=".*"
				[ -n "$stamgr_ssid" ] && ssid_rgx="\"$stamgr_ssid\"" || ssid_rgx=".*"
				[ -n "$stamgr_radio" ] && radio_rgx="$stamgr_radio" || radio_rgx=".*"

				regex_str="${bssid_rgx},${ssid_rgx},[\+-],${radio_rgx}\$"
				
				match="$(echo "$scan_results" | grep -m 1 $regex_str)"
				[ -z "$match" ] && { log_print "DEBUG" "sta_section $sta_section not found in scan. Skipping."; sta_idx=$((sta_idx + 1 )); continue; }
				scan_quality="$(echo "$match" | cut -d',' -f 1)"
				if [ "$scan_quality" -gt "$connect_quality_threshold" ] ; then
					attempts=1
					swap_config $sta_section
					set_wifi_iface $stacfgsec $cDISABLED
					uci commit wireless
					check_sta
					while [ "$attempts" -le "$max_retry" ]
					do
						log_print "INFO" "Connecting (attempt $attempts) to ssid:$sta_ssid;bssid:$sta_bssid;radio:$sta_radio;encryption:$sta_encryption;"
						set_wifi_iface $stacfgsec $cENABLED
						reload_wifi
						sleep $(( max_wait / max_retry ))
						unset sta_connected sta_quality sta_ssid sta_bssid sta_radio sta_encryption sta_password
						check_sta
						if [ "$sta_connected" = true ] ; then
							log_print "INFO" "Connected (attempt $attempts)"
							uci commit wireless
							get_current_active_sta_section
							break 2
						else
							if [ "$attempts" = "$max_retry" ] ; then
								log_print "INFO" "Failed (attempt $attempts). Too many attempts, blacklisting this connection for $blacklist_timer seconds"
								update_status_file "$sta_section"
							else
								log_print "INFO" "Failed (attempt $attempts). Sleeping and trying again..."
							fi
							uci revert wireless
							reload_wifi
							sleep 5
						fi
						attempts=$((attempts+1))
					done
				fi
			done
		else
			log_print "DEBUG" "No APs in range."
		fi
	fi
}


log_print "INFO" "Starting..."
find_wireless_stacfg || { log_print "INFO" "No STA Config found in Wireless CFG. Exiting..."; exit 0; }
load_vars || { log_print "ERROR" "Config loading failed, or was abnormal. Exiting..."; exit 1; }
[ "$enabled" = "1" ] || { log_print "INFO" "Disabled. Exiting..."; exit 0; }

# Disable the STA interface straight away so that the AP can be online, if it isn't already
get_stacfg_disabled || { set_wifi_iface $stacfgsec $cDISABLED; reload_wifi; sleep 5; }

update_status_file ""

while true
do
	main_loop
	update_status_file ""
	sleep "$max_wait"
done 
