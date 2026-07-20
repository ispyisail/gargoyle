#!/bin/sh
# Gargoyle settings-profile orchestrator (RFC #97).
#
#   gargoyle_profile.sh export [outfile]      # default /tmp/gargoyle-profile.json
#   gargoyle_profile.sh import <profile.json>
#
# Runs each /usr/lib/gargoyle/profile.d/NN-*.sh part in NN order. Each part
# speaks only its own feature's JSON fragment and its own version's UCI
# schema; this orchestrator owns the envelope (assemble on export, validate
# on import) and the single uci commit. It knows nothing about any feature.

PROFILE_VERSION=1
PROFILE_DIR=/usr/lib/gargoyle/profile.d
PROFILE_LIB=/usr/lib/gargoyle/profile_lib.sh
DEFAULT_OUT=/tmp/gargoyle-profile.json
REPORT_OUT=/etc/gargoyle/import-report.json

[ -e /usr/share/libubox/jshn.sh ] || { echo "jshn not available" >&2 ; exit 1 ; }
. /usr/share/libubox/jshn.sh
[ -e "$PROFILE_LIB" ] && . "$PROFILE_LIB"

# list executable NN-*.sh parts in NN order
_list_parts()
{
	for _p in "$PROFILE_DIR"/[0-9][0-9]-*.sh ; do
		[ -f "$_p" ] || continue
		echo "$_p"
	done | sort
}

do_export()
{
	_out="${1:-$DEFAULT_OUT}"
	_meta_board=$(ubus call system board 2>/dev/null | jsonfilter -e '@.board_name' 2>/dev/null)
	_meta_garg=$(uci -q get gargoyle.global.version)

	# collect each part's fragment inner (the "feature": {...} member),
	# stripping the outer braces off its json_dump. The first "{" and last
	# "}" are always the outer object delimiters regardless of content, so
	# this is safe against any field values.
	_inners=""
	for _part in $(_list_parts) ; do
		_frag=$(sh "$_part" export 2>/dev/null)
		[ -n "$_frag" ] || continue
		_inner=${_frag#*\{}
		_inner=${_inner%\}*}
		case "$_inner" in
			*[!\ ]*) ;;        # has real content
			*)        continue ;;   # empty object -> skip
		esac
		if [ -n "$_inners" ] ; then
			_inners="$_inners,$_inner"
		else
			_inners="$_inner"
		fi
	done

	# envelope via jshn (so its own strings escape correctly), then splice
	# the validated part inners in before its closing brace.
	json_init
	json_add_int profile_version "$PROFILE_VERSION"
	json_add_string created "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	json_add_object source
	json_add_string gargoyle "$_meta_garg"
	json_add_string board "$_meta_board"
	json_close_object
	_env=$(json_dump)
	_body=${_env%\}}
	if [ -n "$_inners" ] ; then
		_full="$_body, $_inners }"
	else
		_full="$_body }"
	fi

	if ! printf '%s' "$_full" | jsonfilter -e '@' >/dev/null 2>&1 ; then
		echo "assembled profile failed JSON validation" >&2
		return 1
	fi
	printf '%s\n' "$_full" > "$_out"
	chmod 600 "$_out" 2>/dev/null
	echo "$_out"
}

do_import()
{
	_prof="$1"
	[ -f "$_prof" ] || { echo "profile not found: $_prof" >&2 ; return 1 ; }
	if ! jsonfilter -i "$_prof" -e '@.profile_version' >/dev/null 2>&1 ; then
		echo "not a valid gargoyle profile: $_prof" >&2
		return 1
	fi

	PROFILE_REPORT_TMP=$(mktemp /tmp/gargoyle-import-report.XXXXXX)
	export PROFILE_REPORT_TMP
	profile_report_init

	for _part in $(_list_parts) ; do
		if ! sh "$_part" import "$_prof" ; then
			_pn=$(basename "$_part" .sh | sed 's/^[0-9]*-//')
			profile_report_add "$_pn" "*" dropped "importer exited non-zero"
		fi
	done

	uci commit
	mkdir -p /etc/gargoyle
	profile_report_flush "$REPORT_OUT"
	rm -f "$PROFILE_REPORT_TMP"

	# relay a one-line summary for the CGI / caller
	jsonfilter -i "$REPORT_OUT" -e '@.summary' 2>/dev/null
}

case "$1" in
	export)
		shift
		do_export "$@"
		;;
	import)
		shift
		do_import "$@"
		;;
	*)
		echo "Usage: $0 export [outfile] | import <profile.json>" >&2
		exit 1
		;;
esac
