#!/usr/bin/haserl
<%
	# This program is copyright © 2026 and is distributed under the terms of the GNU GPL
	# version 2.0 with a special clarification/exception that permits adapting the program to
	# configure proprietary "back end" software provided that all modifications to the web interface
	# itself remain covered by the GPL.
	# See http://gargoyle-router.com/faq.html#qfoss for more information
	#
	# Backs the Backup/Restore page's diagnostic-report feature. Two modes,
	# same underlying report (generate_diagnostic_report.sh) so there is one
	# source of truth for what gets redacted -- these two auth patterns
	# aren't interchangeable (confirmed against this tree's own existing
	# examples): a plain browser download can't carry a POST body, so it
	# validates via the session cookie the same way dump_backup_tarball.sh
	# does; the AJAX call that populates the on-page preview textarea
	# validates via the POST-body hash the same way do_ping.sh does. Getting
	# these swapped silently breaks whichever path it's swapped onto.
	if [ "$REQUEST_METHOD" = "GET" ] ; then
		eval $( gargoyle_session_validator -c "$COOKIE_hash" -e "$COOKIE_exp" -a "$HTTP_USER_AGENT" -i "$REMOTE_ADDR" -r "login.sh" -t $(uci get gargoyle.global.session_timeout) -b "$COOKIE_browser_time"  )

		level="$GET_level"
		case "$level" in
			relaxed) : ;;
			*) level="standard" ;;
		esac

		FNAME="gargoyle_diagnostic_"$(uci -q get system.@system[0].hostname | sed 's/ //g')"_"$(date +%Y%m%d_%H%M%S)".txt"
		echo "Content-type: text/plain"
		echo "Content-disposition: attachment;filename=\"$FNAME\""
		echo ""
		sh /usr/lib/gargoyle/generate_diagnostic_report.sh "$level"
	else
		eval $( gargoyle_session_validator -c "$POST_hash" -e "$COOKIE_exp" -a "$HTTP_USER_AGENT" -i "$REMOTE_ADDR" -r "login.sh" -t $(uci get gargoyle.global.session_timeout) -b "$COOKIE_browser_time"  )

		level="$POST_level"
		case "$level" in
			relaxed) : ;;
			*) level="standard" ;;
		esac

		echo "Content-type: text/plain"
		echo ""
		sh /usr/lib/gargoyle/generate_diagnostic_report.sh "$level"
		echo "Success"
	fi
%>
