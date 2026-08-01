#!/bin/sh
# This program is copyright © 2026 and is distributed under the terms of the GNU GPL
# version 2.0 with a special clarification/exception that permits adapting the program to
# configure proprietary "back end" software provided that all modifications to the web interface
# itself remain covered by the GPL.
# See http://gargoyle-router.com/faq.html#qfoss for more information
#
# Known Devices / Device Groups — shared UCI helper library
#
# Data model (stored in /etc/config/dhcp):
#
#   config host 'static_host_1'
#       option name    'Johns-Laptop'
#       option mac     'AA:BB:CC:DD:EE:FF'
#       option ip      '192.168.1.100'   # optional static IP
#       list group     'family'          # 0+ group memberships (a plain
#       list group     'streaming'       # `option group` scalar -- the
#                                         # pre-multi-group shape -- still
#                                         # reads back fine: `uci show`
#                                         # renders a single-value list
#                                         # identically to a scalar option,
#                                         # one line either way, so no
#                                         # migration is needed for old
#                                         # devices with exactly one group.
#
#   config group 'group_1'
#       option name    'family'
#
# A group's name string is the identity that ties everything together
# (host.group values, restriction/quota/QoS rules' GROUP:<name> targets, and
# nftables set naming below) -- 'config group' sections do not change that,
# they only let a group be DECLARED independent of any device carrying it.
# The full set of defined groups is therefore the union of every unique
# host.group value AND every declared group's option name (get_all_groups
# below) -- a name present in both counts once. A group with no declaration
# still works exactly as before: it exists only as long as >=1 host section
# carries it, and vanishes the moment the last one stops (unchanged,
# pre-existing behaviour). A group WITH a declaration persists at zero
# devices instead -- see docs/standalone-device-groups-plan.md for why this
# was added and why it's safe (manage_groups.sh already creates a group's
# nftables set before any rule can reference it, regardless of device count).
#
# nftables set naming:
#   Group names are sanitized to lowercase, with any character outside
#   [a-z0-9_] replaced by '_', and prefixed with 'grp_' to avoid collisions
#   with other nftables objects.  Names are truncated to 31 characters total
#   (nftables identifier limit).
#   e.g.  "Family Devices" -> "grp_family_devices"
#         "Dad's Phone!"   -> "grp_dad_s_phone_"


# group_to_set_name <group_name>
# Converts a human-readable group name to a safe nftables set name.
group_to_set_name()
{
	printf 'grp_%s' "$(printf '%s' "$1" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9_' '_')" | cut -c1-31
}

# get_all_known_device_sections
# Prints UCI section names for every 'host' section in /etc/config/dhcp.
get_all_known_device_sections()
{
	uci show dhcp 2>/dev/null | grep '=host$' | sed 's/dhcp\.\(.*\)=host/\1/'
}

# get_device_field <section> <field>
# Returns the value of a field for a host section, or empty string if unset.
get_device_field()
{
	uci get "dhcp.$1.$2" 2>/dev/null
}

# get_device_groups <section>
# Prints every group name a host section belongs to (0, 1, or many --
# one per line). Reads via `uci show` rather than `uci get`. Verified
# against the real router (not assumed): a `list` option with multiple
# values renders as ONE "key='A' 'B'" line, space-separated with each
# value individually quoted -- NOT one line per value. Since group names
# are charset-restricted to [a-zA-Z0-9_-] (no spaces, no quotes -- see the
# dev_new_group validation in dhcp.js), stripping quotes and splitting on
# the remaining spaces is a safe, portable parse (no GNU-sed-specific
# escapes needed). A legacy single-value `option group 'family'` line
# already has no interior spaces, so it passes through unsplit -- one
# consistent pipeline for both shapes.
get_device_groups()
{
	uci show dhcp 2>/dev/null | grep "^dhcp\.$1\.group=" | sed "s/^[^=]*=//; s/'//g" | tr ' ' '\n'
}

# get_all_declared_group_sections
# Prints UCI section names for every 'group' section in /etc/config/dhcp.
get_all_declared_group_sections()
{
	uci show dhcp 2>/dev/null | grep '=group$' | sed 's/dhcp\.\(.*\)=group/\1/'
}

# find_declared_group_section <group_name>
# Prints the UCI section name of the 'group' section whose option name
# exactly matches (case-sensitive, matching every other group-name
# comparison in this codebase), or nothing + failure if none declares it.
find_declared_group_section()
{
	local target="$1"
	local gsections
	gsections=$(get_all_declared_group_sections)
	local gsection
	for gsection in $gsections
	do
		if [ "$(get_device_field "$gsection" "name")" = "$target" ]
		then
			echo "$gsection"
			return 0
		fi
	done
	return 1
}

# get_all_groups
# Prints each unique group name (one per line): every host section's group
# value, unioned with every declared group's name, so a zero-device
# declared group still appears and a name present in both counts once.
get_all_groups()
{
	{
		local sections
		sections=$(get_all_known_device_sections)
		local section
		for section in $sections
		do
			get_device_groups "$section"
		done

		local gsections
		gsections=$(get_all_declared_group_sections)
		local gsection
		for gsection in $gsections
		do
			get_device_field "$gsection" "name"
		done
	} | sort -u | grep -v '^$'
}

# get_sections_in_group <group_name>
# Prints the UCI section names of every host that belongs to the given
# group -- a host with several groups matches every one of them, not just
# a single "the" group, so it's counted (and its IP seeded into the
# nftables set) for each.
get_sections_in_group()
{
	local target_group="$1"
	local sections
	sections=$(get_all_known_device_sections)
	local section
	for section in $sections
	do
		if get_device_groups "$section" | grep -qxF "$target_group"
		then
			echo "$section"
		fi
	done
}

# get_macs_in_group <group_name>
# Prints the MAC address of every host that belongs to the given group.
get_macs_in_group()
{
	local sections
	sections=$(get_sections_in_group "$1")
	local section
	for section in $sections
	do
		get_device_field "$section" "mac"
	done | grep -v '^$'
}
