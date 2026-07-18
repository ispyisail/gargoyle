#!/bin/sh
# check_plugin_descriptions.sh -- lint every Gargoyle plugin package's
# Description so it renders as a clean one-line title on the Plugins page.
#
# Why this exists: the Plugins page (package/gargoyle/files/www/js/plugins.js,
# createDisplayDiv) uses each package's Description field, verbatim and split
# on newlines, as the entry's bold heading. A multi-line or over-long
# Description therefore becomes a wall-of-text title. This shipped for
# plugin-gargoyle-captive-portal (a four-line paragraph) and several others
# before it was noticed on a real router; this lint stops it recurring.
#
# Rule, per `define Package/<name>/description ... endef` block found under
# package/plugin-gargoyle-*/Makefile:
#   - the body must be exactly ONE non-empty line
#   - that line must be <= MAX_LEN characters (default 80)
# Blank/whitespace-only lines inside the block are ignored (some Makefiles
# pad the block); leading/trailing whitespace is stripped before measuring.
#
# Usage: check_plugin_descriptions.sh [gargoyle_tree_root]
#   default root is two levels up from this script (dev-utils/lint/..).
# Exit 0 = clean, 1 = at least one offending description, 2 = usage error.
set -e

MAX_LEN="${MAX_LEN:-80}"

root="${1:-}"
if [ -z "$root" ]; then
	root=$(cd "$(dirname "$0")/../.." && pwd)
fi
pkg_dir="$root/package"
if [ ! -d "$pkg_dir" ]; then
	echo "error: no package/ dir under $root" >&2
	exit 2
fi

# One awk pass over every plugin Makefile. For each description block it emits
# a single TAB-separated record only when the block is bad:
#   <file>\t<pkgname>\t<reason>
# The block body is everything strictly between "define .../description" and
# its endef; leading/trailing whitespace is stripped so indentation does not
# count against MAX_LEN, and blank lines are not counted as content.
findings=$(awk -v MAXLEN="$MAX_LEN" '
	FNR == 1 { file = FILENAME }
	/^define[ \t]+Package\/[^ \t]+\/description[ \t]*$/ {
		name = $2
		sub(/^Package\//, "", name)
		sub(/\/description$/, "", name)
		inblk = 1; n = 0; maxlen = 0
		next
	}
	inblk && /^endef[ \t]*$/ {
		if (n > 1) {
			printf "%s\t%s\tdescription is %d lines -- must be a single line (it becomes the Plugins-page title)\n", file, name, n
		} else if (maxlen > MAXLEN) {
			printf "%s\t%s\tdescription line is %d chars -- must be <= %d\n", file, name, maxlen, MAXLEN
		}
		inblk = 0
		next
	}
	inblk {
		line = $0
		gsub(/^[ \t]+/, "", line)
		gsub(/[ \t]+$/, "", line)
		if (line != "") {
			n++
			if (length(line) > maxlen) { maxlen = length(line) }
		}
	}
' "$pkg_dir"/plugin-gargoyle-*/Makefile)

scanned=$(ls -d "$pkg_dir"/plugin-gargoyle-*/ 2>/dev/null | wc -l | tr -d ' ')

if [ -n "$findings" ]; then
	echo "Plugin description lint FAILED:" >&2
	# IFS split on TAB only, so the reason text keeps its spaces.
	printf '%s\n' "$findings" | while IFS='	' read -r file name reason; do
		echo "  $name: $reason" >&2
		echo "    $file" >&2
	done
	echo "" >&2
	echo "Each plugin Description is shown verbatim as the entry title on the" >&2
	echo "Plugins page. Keep it to one line <= $MAX_LEN chars; move any extra" >&2
	echo "detail (author credits, URLs, notes) into a Makefile comment above" >&2
	echo "the description block." >&2
	exit 1
fi

echo "plugin description lint: OK ($scanned plugin dirs scanned)"
