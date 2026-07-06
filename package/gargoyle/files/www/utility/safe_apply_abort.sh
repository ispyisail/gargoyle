#!/usr/bin/haserl
<?
	# This program is copyright © 2008 Eric Bishop and is distributed under the terms of the GNU GPL
	# version 2.0 with a special clarification/exception that permits adapting the program to
	# configure proprietary "back end" software provided that all modifications to the web interface
	# itself remain covered by the GPL.
	# See http://gargoyle-router.com/faq.html#qfoss for more information
	#
	# Companion to safe_apply_confirm.sh: lets the admin explicitly undo a
	# pending change before the timeout, instead of waiting it out. The
	# watchdog loop in usr/lib/gargoyle/safe_apply.sh already checks for this
	# marker on every poll.
	eval $( gargoyle_session_validator -c "$POST_hash" -e "$COOKIE_exp" -a "$HTTP_USER_AGENT" -i "$REMOTE_ADDR" -r "login.sh" -t $(uci get gargoyle.global.session_timeout) -b "$COOKIE_browser_time"  )

	echo "Content-type: text/plain"
	echo ""

	. /usr/lib/gargoyle/safe_apply.sh

	if [ -n "$FORM_id" ] && safe_apply_valid_id "$FORM_id" ; then
		mkdir -p "/tmp/safe_apply/$FORM_id"
		touch "/tmp/safe_apply/$FORM_id/abort"
		echo "Success"
	else
		echo "Failure: invalid id"
	fi
?>
