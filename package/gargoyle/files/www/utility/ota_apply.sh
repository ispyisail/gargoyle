#!/usr/bin/haserl
<?
	# RFC #62 signed OTA upgrade -- launches usr/lib/gargoyle/ota_upgrade.sh
	# apply DETACHED. This is the irreversible one: `apply` re-verifies,
	# runs validate_firmware_image, then `exec sysupgrade`, which severs
	# networking during the flash/reboot exactly like a manual upload's
	# sysupgrade does. Detach pattern matches safe_apply_run.sh exactly,
	# including its `sleep 2` -- that gap is what lets THIS response reach
	# the browser before the box starts flashing, not a stylistic copy.
	#
	# $FORM_mode: "clean" wipes settings (ota_upgrade.sh apply clean, i.e.
	# sysupgrade -n); anything else keeps the default keep-settings apply.
	# Constrained by the case statement below, not passed through raw.
	eval $( gargoyle_session_validator -c "$POST_hash" -e "$COOKIE_exp" -a "$HTTP_USER_AGENT" -i "$REMOTE_ADDR" -r "login.sh" -t $(uci get gargoyle.global.session_timeout) -b "$COOKIE_browser_time"  )

	echo "Content-type: text/plain"
	echo ""

	case "$FORM_mode" in
		clean) mode_arg="clean" ;;
		*)     mode_arg="" ;;
	esac

	run_file="/tmp/ota_apply_run.sh"
	{
		echo '#!/bin/sh'
		echo 'exec >/dev/null 2>&1 </dev/null'
		echo 'sleep 2'
		echo "sh /usr/lib/gargoyle/ota_upgrade.sh apply $mode_arg"
		# Reached only if apply was REFUSED before flashing -- a successful
		# apply ends in `exec sysupgrade`, which replaces this process, so
		# this line never runs in that case (harmless: /tmp is gone anyway
		# once the new firmware boots).
		echo "rm -f \"$run_file\""
	} > "$run_file"
	chmod +x "$run_file"

	echo "applying=1"

	start-stop-daemon -S -b -x "$run_file" </dev/null >/dev/null 2>&1
?>
