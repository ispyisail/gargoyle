#!/usr/bin/haserl
<?
	# This program is copyright © 2008-2013 Eric Bishop and is distributed under the terms of the GNU GPL
	# version 2.0 with a special clarification/exception that permits adapting the program to
	# configure proprietary "back end" software provided that all modifications to the web interface
	# itself remain covered by the GPL.
	# See http://gargoyle-router.com/faq.html#qfoss for more information
	#
	# Settings-profile export endpoint (RFC #97). Generates a hardware-free
	# intent profile and streams it as a download in one step -- export is
	# fast (a few UCI reads), unlike create_backup.sh which stops/starts
	# daemons, so no separate "prepare" POST is needed. Auth mirrors
	# dump_backup_tarball.sh (GET with the session cookie).
	eval $( gargoyle_session_validator -c "$COOKIE_hash" -e "$COOKIE_exp" -a "$HTTP_USER_AGENT" -i "$REMOTE_ADDR" -r "login.sh" -t $(uci get gargoyle.global.session_timeout) -b "$COOKIE_browser_time"  )

	PROFILE_TMP="/tmp/gargoyle-profile.json"
	sh /usr/lib/gargoyle/gargoyle_profile.sh export "$PROFILE_TMP" >/dev/null 2>&1

	FN="gargoyle-profile_"$(uci -q get system.@system[0].hostname | sed 's/ //g')"_"$(date +%Y%m%d_%H%M%S)".json"
	echo "Content-type: application/json"
	echo "Content-disposition: attachment;filename=\"$FN\""
	echo ""

	if [ -f "$PROFILE_TMP" ] ; then
		cat "$PROFILE_TMP"
		rm -f "$PROFILE_TMP"
	fi
?>
