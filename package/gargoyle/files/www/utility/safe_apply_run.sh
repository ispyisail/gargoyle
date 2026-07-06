#!/usr/bin/haserl
<?
	# This program is copyright © 2008 Eric Bishop and is distributed under the terms of the GNU GPL
	# version 2.0 with a special clarification/exception that permits adapting the program to
	# configure proprietary "back end" software provided that all modifications to the web interface
	# itself remain covered by the GPL.
	# See http://gargoyle-router.com/faq.html#qfoss for more information
	#
	# Drop-in replacement for utility/run_commands.sh for saves that touch
	# VLAN state (WAN VLAN table, LAN VLAN Manager): applies the posted
	# commands exactly like run_commands.sh does, but snapshots the affected
	# UCI config files first and launches a detached watchdog that reverts
	# them automatically if utility/safe_apply_confirm.sh isn't hit within
	# the timeout window. See usr/lib/gargoyle/safe_apply.sh.
	eval $( gargoyle_session_validator -c "$POST_hash" -e "$COOKIE_exp" -a "$HTTP_USER_AGENT" -i "$REMOTE_ADDR" -r "login.sh" -t $(uci get gargoyle.global.session_timeout) -b "$COOKIE_browser_time"  )

	echo "Content-type: text/plain"
	echo ""

	. /usr/lib/gargoyle/safe_apply.sh

	if [ -n "$FORM_commands" ] ; then

		lock_file="/tmp/safe_apply.lock"
		exec 9>"$lock_file"
		if ! flock -n 9 ; then
			echo "Busy: another network change is already pending confirmation."
			exit 0
		fi

		case "$FORM_timeout" in
			''|*[!0-9]*) timeout=45 ;;
			*)           timeout=$FORM_timeout ;;
		esac

		id="$(date +%s)_$$"

		safe_apply_snapshot "$id" "$timeout"

		tmp_file="/tmp/safe_apply_${id}.sh"
		printf "%s" "$FORM_commands" | tr -d "\r" > "$tmp_file"
		sh "$tmp_file"
		rm -f "$tmp_file"

		start-stop-daemon -S -b -x /usr/lib/gargoyle/safe_apply.sh -- watchdog "$id" "$timeout"

		flock -u 9

		echo "apply_id=$id"
		echo "timeout=$timeout"
	else
		echo "Failure: no commands"
	fi
?>
