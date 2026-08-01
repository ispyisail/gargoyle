#!/usr/bin/haserl
<%
	# This program is copyright © 2008-2013 Eric Bishop and is distributed under the terms of the GNU GPL
	# version 2.0 with a special clarification/exception that permits adapting the program to
	# configure proprietary "back end" software provided that all modifications to the web interface
	# itself remain covered by the GPL.
	# See http://gargoyle-router.com/faq.html#qfoss for more information
	eval $( gargoyle_session_validator -c "$COOKIE_hash" -e "$COOKIE_exp" -a "$HTTP_USER_AGENT" -i "$REMOTE_ADDR" -r "login.sh" -t $(uci get gargoyle.global.session_timeout) -b "$COOKIE_browser_time"  )
	gargoyle_header_footer -h -s "firewall" -p "restriction" -j "table.js restrictions.js" -z "restrictions.js" gargoyle firewall

%>

<script>
<!--
<%
	echo "var knownDeviceGroups = [];"
	. /usr/lib/gargoyle/known_devices.sh
	get_all_groups | while read grp ; do
		escaped=$(printf '%s' "$grp" | sed 's/\\/\\\\/g; s/"/\\"/g')
		printf 'knownDeviceGroups.push("%s");\n' "$escaped"
	done
	# Same tz-offset export basic.sh already does for its own page -- lets
	# a timed-disable's "Disabled until HH:MM" render in the ROUTER's local
	# time, not the admin's browser, consistent with how every other
	# schedule field on this page is already interpreted.
	echo "var timezoneOffStr = \""$(date +%z)"\";"
%>
	var uci = uciOriginal.clone();
//-->
</script>

<h1 class="page-header"><%~ restrictions.mRestrict %></h1>

<div class="row">
	<div id="restriction_wizard_callout" class="col-lg-6">
		<div class="panel panel-info">
			<div class="panel-body">
				<p><%~ restrictions.FTWIntro %></p>
				<button id="restriction_wizard_open" class="btn btn-primary" onclick="openFamilyTimeWizard()"><%~ restrictions.FTWBtn %></button>
			</div>
		</div>
	</div>
</div>

<div class="row">
	<div class="col-lg-6">
		<div class="panel panel-default">
			<div class="panel-heading">
				<h3 class="panel-title"><%~ restrictions.ARSect %></h3>
			</div>

			<div class="panel-body">
				<div class="row form-group">
					<span id="add_rule_label" class="col-xs-12" style="text-decoration:underline" ><%~ NRRule %>:</span>
					<span class="col-xs-12">
						<button id="add_restriction_button" class="btn btn-default btn-add" onclick="addRestrictionModal(true)"><%~ ANRule %></button>
					</span>
				</div>

				<div id="internal_divider1" class="internal_divider"></div>
				<div class="row form-group">
					<span class="col-xs-12">
						<span id="current_rule_label" style="text-decoration:underline"><%~ CRestr %>:</span>
						<div id="rule_table_container" class="table-responsive"></div>
					</span>
				</div>
			</div>
		</div>
	</div>

	<div class="col-lg-6">
		<div class="panel panel-default">
			<div class="panel-heading">
				<h3 class="panel-title"><%~ EWSect %></h3>
			</div>
			<div class="panel-body">
				<div class="row form-group">
					<span id="add_exception_label" class="col-xs-12" style="text-decoration:underline"><%~ NExcp %>:</span>
					<span class="col-xs-12">
						<button id="add_restriction_button" class="btn btn-default btn-add" onclick="addRestrictionModal(false)"><%~ ANRule %></button>
					</span>
				</div>

				<div id="internal_divider1" class="internal_divider"></div>
				<div class="row form-group">
					<span class="col-xs-12">
						<span id="current_exceptions_label" style="text-decoration:underline" ><%~ CExcp %>:</span>
						<div id="exception_table_container" class="table-responsive"></div>
					</span>
				</div>
			</div>
		</div>
	</div>
</div>

<div id="bottom_button_container" class="panel panel-default">
	<button id="save_button" class="btn btn-primary btn-lg" onclick="saveChanges()"><%~ SaveChanges %></button>
	<button id="reset_button" class="btn btn-warning btn-lg" onclick="resetData()"><%~ Reset %></button>
</div>

<div class="modal fade" tabindex="-1" role="dialog" id="family_time_wizard_modal" aria-hidden="true" aria-labelledby="family_time_wizard_modal_title">
	<div class="modal-dialog" role="document">
		<div class="modal-content">
			<div class="modal-header">
				<h3 id="family_time_wizard_modal_title" class="panel-title"><%~ restrictions.FTWTitle %></h3>
			</div>
			<div class="modal-body">
				<div id="family_time_wizard_noGroups" style="display:none">
					<p><%~ restrictions.FTWNoGroups %></p>
				</div>

				<div id="family_time_wizard_step1" style="display:none">
					<p><%~ restrictions.FTWStep1Desc %></p>
					<div id="family_time_wizard_group_list"></div>
				</div>

				<div id="family_time_wizard_step2" style="display:none">
					<p><%~ restrictions.FTWStep2Desc %></p>
					<div class="row form-group">
						<label class="col-xs-3" for='family_time_wizard_from'><%~ restrictions.FTWFrom %>:</label>
						<span class="col-xs-3"><input type='text' class="form-control" id='family_time_wizard_from' size='6' placeholder='21:00' /></span>
						<label class="col-xs-3" for='family_time_wizard_to'><%~ restrictions.FTWTo %>:</label>
						<span class="col-xs-3"><input type='text' class="form-control" id='family_time_wizard_to' size='6' placeholder='07:00' /></span>
					</div>
					<div class="row form-group">
						<label class="col-xs-5"><%~ restrictions.FTWDays %>:</label>
						<span class="col-xs-7">
							<input type='checkbox' id='family_time_wizard_sun' checked /><label for="family_time_wizard_sun"><%~ Sun %></label>
							<input type='checkbox' id='family_time_wizard_mon' checked /><label for="family_time_wizard_mon"><%~ Mon %></label>
							<input type='checkbox' id='family_time_wizard_tue' checked /><label for="family_time_wizard_tue"><%~ Tue %></label>
							<input type='checkbox' id='family_time_wizard_wed' checked /><label for="family_time_wizard_wed"><%~ Wed %></label>
							<input type='checkbox' id='family_time_wizard_thu' checked /><label for="family_time_wizard_thu"><%~ Thu %></label>
							<input type='checkbox' id='family_time_wizard_fri' checked /><label for="family_time_wizard_fri"><%~ Fri %></label>
							<input type='checkbox' id='family_time_wizard_sat' checked /><label for="family_time_wizard_sat"><%~ Sat %></label>
						</span>
					</div>
				</div>

				<div id="family_time_wizard_done" style="display:none">
					<p><%~ restrictions.FTWDone %></p>
					<p><em><%~ restrictions.FTWOverrideHint %></em></p>
				</div>
			</div>
			<div class="modal-footer" id="family_time_wizard_modal_button_container">
			</div>
		</div>
	</div>
</div>

<div class="modal fade" tabindex="-1" role="dialog" id="restriction_rule_modal" aria-hidden="true" aria-labelledby="restriction_rule_modal_title">
	<div class="modal-dialog" role="document">
		<div class="modal-content">
			<div class="modal-header">
				<h3 id="restriction_rule_modal_title" class="panel-title"><%~ NRRule %></h3>
			</div>
			<div class="modal-body">
				<%in templates/restriction_template %>
			</div>
			<div class="modal-footer" id="restriction_rule_modal_button_container">
			</div>
		</div>
	</div>
</div>

<div class="modal fade" tabindex="-1" role="dialog" id="whitelist_rule_modal" aria-hidden="true" aria-labelledby="whitelist_rule_modal_title">
	<div class="modal-dialog" role="document">
		<div class="modal-content">
			<div class="modal-header">
				<h3 id="whitelist_rule_modal_title" class="panel-title"><%~ NExcp %></h3>
			</div>
			<div class="modal-body">
				<%in templates/whitelist_template %>
			</div>
			<div class="modal-footer" id="whitelist_rule_modal_button_container">
			</div>
		</div>
	</div>
</div>

<script>
<!--
	resetData();
//-->
</script>

<%
	gargoyle_header_footer -f -s "firewall" -p "restriction"
%>
