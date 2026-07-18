#!/usr/bin/haserl
<?
	# RFC #62 signed OTA upgrade -- polled every ~2s by js/ota.js while a
	# download or apply is in flight. Deliberately minimal: just echoes
	# whatever usr/lib/gargoyle/ota_upgrade.sh's own ota_status() last wrote
	# to /tmp/ota_status (state=.../detail=.../updated=...), matching
	# safe_apply_status.sh's own "read the one file, don't reshape it"
	# approach for the same kind of poll.
	eval $( gargoyle_session_validator -c "$POST_hash" -e "$COOKIE_exp" -a "$HTTP_USER_AGENT" -i "$REMOTE_ADDR" -r "login.sh" -t $(uci get gargoyle.global.session_timeout) -b "$COOKIE_browser_time"  )

	echo "Content-type: text/plain"
	echo ""

	cat /tmp/ota_status 2>/dev/null
?>
