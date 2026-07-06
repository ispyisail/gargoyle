#!/usr/bin/haserl
<?
	# This program is copyright © 2008 Eric Bishop and is distributed under the terms of the GNU GPL
	# version 2.0 with a special clarification/exception that permits adapting the program to
	# configure proprietary "back end" software provided that all modifications to the web interface
	# itself remain covered by the GPL.
	# See http://gargoyle-router.com/faq.html#qfoss for more information
	#
	# Polled via a hidden iframe by js/safe_apply.js while a safe-apply
	# confirmation is pending -- same "is the router reachable again" idiom
	# utility/reboot_test.sh already uses for reboots. The remaining-seconds
	# countdown itself is tracked client-side from the timestamp js/safe_apply.js
	# stashed in localStorage when the apply was submitted; this endpoint only
	# needs to answer "yes, I got a response", so it mirrors reboot_test.sh's
	# minimal content deliberately, not to duplicate that logic server-side.
	eval $( gargoyle_session_validator -c "$POST_hash" -e "$COOKIE_exp" -a "$HTTP_USER_AGENT" -i "$REMOTE_ADDR" -r "login.sh" -t $(uci get gargoyle.global.session_timeout) -b "$COOKIE_browser_time"  )

	echo "Content-Type: text/html; charset=utf-8"
	echo ""

	echo '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">'
	echo '<html xmlns="http://www.w3.org/1999/xhtml">'
	echo '<body>'
	echo "<div id='safe_apply_test'>LOADED</div>"
	echo "</body></html>"
?>
