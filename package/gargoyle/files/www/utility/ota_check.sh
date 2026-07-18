#!/usr/bin/haserl
<?
	# RFC #62 signed OTA upgrade -- "Check for updates" button on the
	# System > Update page (js/ota.js otaCheck()). Runs synchronously: a
	# manifest fetch + usign verify is a few seconds at most, well within
	# what a button click can reasonably wait for, so unlike
	# ota_download.sh/ota_apply.sh this does not need to detach.
	#
	# Returns usr/lib/gargoyle/ota_upgrade.sh's own key=value stdout
	# verbatim -- js/ota.js parses it directly, no reshaping needed here.
	eval $( gargoyle_session_validator -c "$POST_hash" -e "$COOKIE_exp" -a "$HTTP_USER_AGENT" -i "$REMOTE_ADDR" -r "login.sh" -t $(uci get gargoyle.global.session_timeout) -b "$COOKIE_browser_time"  )

	echo "Content-type: text/plain"
	echo ""

	sh /usr/lib/gargoyle/ota_upgrade.sh check
?>
