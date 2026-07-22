#!/usr/bin/haserl --upload-limit=4096 --upload-dir=/tmp/
<?
	# This program is copyright © 2008-2013 Eric Bishop and is distributed under the terms of the GNU GPL
	# version 2.0 with a special clarification/exception that permits adapting the program to
	# configure proprietary "back end" software provided that all modifications to the web interface
	# itself remain covered by the GPL.
	# See http://gargoyle-router.com/faq.html#qfoss for more information
	#
	# Settings-profile import endpoint (RFC #97). Accepts an uploaded profile
	# JSON, runs the orchestrator (which regenerates native config for THIS
	# firmware version and writes /etc/gargoyle/import-report.json), and
	# hands the report back to the parent page via the hidden-iframe callback
	# idiom used by do_restore.sh. Auth uses POST_hash (the form carries the
	# hash) exactly like do_restore.sh.
	eval $( gargoyle_session_validator -c "$POST_hash" -e "$COOKIE_exp" -a "$HTTP_USER_AGENT" -i "$REMOTE_ADDR" -r "login.sh" -t $(uci get gargoyle.global.session_timeout) -b "$COOKIE_browser_time"  )

	# CGI headers first (mirrors restore.sh) -- without these uhttpd returns
	# 502 even though the body is produced.
	echo "Content-Type: text/html; charset=utf-8"
	echo ""

	echo "<html><body>"

	if [ -z "$FORM_profile_file" ] || [ ! -f "$FORM_profile_file" ] ; then
		echo "<script type=\"text/javascript\">top.profileImportFailed();</script>"
		echo "</body></html>"
		exit 0
	fi

	# Reject anything that isn't a valid gargoyle profile before touching UCI.
	if ! jsonfilter -i "$FORM_profile_file" -e '@.profile_version' >/dev/null 2>&1 ; then
		rm -f "$FORM_profile_file"
		echo "<script type=\"text/javascript\">top.profileImportFailed();</script>"
		echo "</body></html>"
		exit 0
	fi

	sh /usr/lib/gargoyle/gargoyle_profile.sh import "$FORM_profile_file" >/dev/null 2>&1
	rm -f "$FORM_profile_file"

	# The report is machine-generated JSON with a controlled vocabulary
	# (feature/field/outcome from fixed sets, developer-authored reasons), so
	# it is safe to inline as a JS object literal. printf (not echo) so no
	# backslash in the JSON is reinterpreted by busybox echo.
	REPORT=$(cat /etc/gargoyle/import-report.json 2>/dev/null)
	if [ -z "$REPORT" ] ; then
		echo "<script type=\"text/javascript\">top.profileImportFailed();</script>"
	else
		printf '<script type="text/javascript">top.profileImportComplete(%s);</script>\n' "$REPORT"
	fi
	echo "</body></html>"
?>
