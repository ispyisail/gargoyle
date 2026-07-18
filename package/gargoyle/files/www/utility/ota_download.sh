#!/usr/bin/haserl
<?
	# RFC #62 signed OTA upgrade -- launches usr/lib/gargoyle/ota_upgrade.sh
	# download DETACHED (a full image fetch can take a while) and returns
	# immediately; js/ota.js then polls utility/ota_status.sh, which just
	# reads the SAME /tmp/ota_status file ota_upgrade.sh already writes at
	# each step (checking/downloading/verifying/ready/failed) -- no separate
	# progress-tracking mechanism invented here.
	#
	# Detach pattern matches safe_apply_run.sh: the launched script closes
	# its own stdio first so the CGI's own response can flush independently.
	# No confirm/revert/watchdog needed here (unlike safe_apply) -- a failed
	# or interrupted download just leaves state=failed in the status file,
	# nothing was ever applied to the running config.
	eval $( gargoyle_session_validator -c "$POST_hash" -e "$COOKIE_exp" -a "$HTTP_USER_AGENT" -i "$REMOTE_ADDR" -r "login.sh" -t $(uci get gargoyle.global.session_timeout) -b "$COOKIE_browser_time"  )

	echo "Content-type: text/plain"
	echo ""

	lock_file="/tmp/ota_download.lock"
	exec 9>"$lock_file"
	if ! flock -n 9 ; then
		echo "busy=1"
		exit 0
	fi

	run_file="/tmp/ota_download_run.sh"
	{
		echo '#!/bin/sh'
		echo 'exec >/dev/null 2>&1 </dev/null'
		echo 'sh /usr/lib/gargoyle/ota_upgrade.sh download'
		echo "rm -f \"$run_file\""
	} > "$run_file"
	chmod +x "$run_file"

	flock -u 9

	echo "started=1"

	# Launch by its own unique path, NOT `-x /bin/sh` -- `-S` refuses to
	# start when a process already matches `-x`, and haserl's own shell
	# children mean /bin/sh is always already running in this CGI context
	# (the #96 lesson; see safe_apply_run.sh's identical comment).
	start-stop-daemon -S -b -x "$run_file" </dev/null >/dev/null 2>&1
?>
