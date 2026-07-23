#!/usr/bin/haserl --upload-limit=4096 --upload-dir=/tmp/
<?
	# This program is copyright © 2008-2013 Eric Bishop and is distributed under the terms of the GNU GPL
	# version 2.0 with a special clarification/exception that permits adapting the program to
	# configure proprietary "back end" software provided that all modifications to the web interface
	# itself remain covered by the GPL.
	# See http://gargoyle-router.com/faq.html#qfoss for more information
	#
	# RFC #117: runs create_backup.sh, optionally encrypting the tarball. The
	# passphrase arrives as a POST field and is handed to create_backup.sh via
	# an environment variable (GARGOYLE_BACKUP_PASS) -- never on argv, so it is
	# not visible in the process list -- exactly as the login password is
	# submitted over the same session. backup.js then downloads the result via
	# dump_backup_tarball.sh.
	eval $( gargoyle_session_validator -c "$POST_hash" -e "$COOKIE_exp" -a "$HTTP_USER_AGENT" -i "$REMOTE_ADDR" -r "login.sh" -t $(uci get gargoyle.global.session_timeout) -b "$COOKIE_browser_time"  )

	if [ "$POST_encrypt" = "1" ] && [ -n "$POST_passphrase" ] ; then
		export GARGOYLE_BACKUP_PASS="$POST_passphrase"
	fi
	sh /usr/lib/gargoyle/create_backup.sh >/dev/null 2>&1
	unset GARGOYLE_BACKUP_PASS

	echo "Content-Type: text/plain"
	echo ""
	echo "OK"
?>
