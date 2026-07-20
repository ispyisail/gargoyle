# This program is copyright © 2008 Eric Bishop and is distributed under the terms of the GNU GPL
# version 2.0 with a special clarification/exception that permits adapting the program to
# configure proprietary "back end" software provided that all modifications to the web interface
# itself remain covered by the GPL.
# See http://gargoyle-router.com/faq.html#qfoss for more information


#make sure all settings have been written to file
uci commit

#force write of webmon & bwmon
bwmon_enabled=$(ls /etc/rc.d/*bwmon* 2>/dev/null)
webmon_enabled=$(ls /etc/rc.d/*webmon* 2>/dev/null)
if [ -n "$bwmon_enabled" ] ; then
	/etc/init.d/bwmon_gargoyle stop
fi
if [ -n "$webmon_enabled" ] ; then
	/etc/init.d/webmon_gargoyle stop
fi

# Everything sysupgrade would already preserve (its own conf file plus
# every plugin's keep.d fragment -- see /sbin/sysupgrade's own reading of
# these two, RFC #98) is exactly what a full backup should also capture,
# plus two backup-only extras that are transient runtime state, not config,
# and must never survive an in-place sysupgrade: /tmp/data and /usr/data.
backup_only_extras='/tmp/data /usr/data'
backup_locations="$(cat /etc/sysupgrade.conf /lib/upgrade/keep.d/* 2>/dev/null) $backup_only_extras"
existing_locations=""
for bl in $backup_locations ; do
	if [ -e "$bl" ] ; then
		existing_locations="$existing_locations $bl"
	fi
done

if [ -e /tmp/backup ] ; then
	rm -rf /tmp/backup
fi
mkdir -p /tmp/backup
cd /tmp/backup

# RFC #98 B2: a manifest inside the tarball, so a future restore can
# validate board/version/plugin-set before extracting (RFC #98 Phase P2 --
# not built yet, this just writes the data it will need).
gargoyle_version="$(uci -q get gargoyle.global.version)"
openwrt_release="$(cat /etc/openwrt_release 2>/dev/null | grep DISTRIB_RELEASE | cut -d "'" -f 2)"
board_name="$(ubus call system board 2>/dev/null | jsonfilter -e '@.board_name')"
gen_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
installed_plugins="$(opkg list-installed 2>/dev/null | grep '^plugin-gargoyle-' | awk '{print $1}' | sort | tr '\n' ' ')"

manifest_paths_json=""
for bl in $existing_locations ; do
	if [ -n "$manifest_paths_json" ] ; then
		manifest_paths_json="$manifest_paths_json,"
	fi
	manifest_paths_json="$manifest_paths_json\"$bl\""
done

manifest_plugins_json=""
for pl in $installed_plugins ; do
	if [ -n "$manifest_plugins_json" ] ; then
		manifest_plugins_json="$manifest_plugins_json,"
	fi
	manifest_plugins_json="$manifest_plugins_json\"$pl\""
done

cat > gargoyle-backup-manifest.json <<EOF
{
	"schema": 1,
	"gargoyle_version": "$gargoyle_version",
	"openwrt_release": "$openwrt_release",
	"board_name": "$board_name",
	"generated": "$gen_time",
	"paths": [$manifest_paths_json],
	"plugins": [$manifest_plugins_json]
}
EOF

tar cvzf backup.tar.gz $existing_locations gargoyle-backup-manifest.json 2>/dev/null
chmod 777 backup.tar.gz
garg_web_root=$(uci get gargoyle.global.web_root)
if [ -z "$garg_web_root" ] ; then
	garg_web_root = "/www"
fi

if [ -n "$bwmon_enabled" ] ; then
	/etc/init.d/bwmon_gargoyle start
fi
if [ -n "$webmon_enabled" ] ; then
	/etc/init.d/webmon_gargoyle start
fi


