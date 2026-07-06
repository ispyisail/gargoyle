#!/usr/bin/haserl
<%
	# This program is copyright © 2008-2013 Eric Bishop and is distributed under the terms of the GNU GPL
	# version 2.0 with a special clarification/exception that permits adapting the program to
	# configure proprietary "back end" software provided that all modifications to the web interface
	# itself remain covered by the GPL.
	# See http://gargoyle-router.com/faq.html#qfoss for more information
	eval $( gargoyle_session_validator -c "$COOKIE_hash" -e "$COOKIE_exp" -a "$HTTP_USER_AGENT" -i "$REMOTE_ADDR" -r "login.sh" -t $(uci get gargoyle.global.session_timeout) -b "$COOKIE_browser_time" )
	gargoyle_header_footer -h -s "connection" -p "vlan" -j "vlan.js safe_apply.js table.js" -z "vlan.js" -i gargoyle network firewall dhcp
%>

<script>
<!--
<%
	# Detect hardware VLAN model: DSA vs swconfig. Only DSA gets the full
	# editor below -- swconfig hardware sees a "not supported" notice instead
	# of a second, untested save path (see the per-port ports list this
	# feature writes, which assumes DSA's bridge-vlan UCI model throughout).
	if [ -e /etc/board.json ] && grep -q '"ports"' /etc/board.json 2>/dev/null ; then
		hw_model="dsa"
	elif [ -e /sbin/swconfig ] ; then
		hw_model="swconfig"
	else
		hw_model="none"
	fi
	echo "var vlanHwModel = \"$hw_model\";"

	# Per-port link status + VLAN membership (DSA only -- swconfig/none get
	# an empty list, which vlan.js never reads since it gates on vlanHwModel
	# first). See switchinfo.sh's get_vlan_membership() for the third column.
	echo "var ports = new Array();"
	if [ "$hw_model" = "dsa" ] ; then
		/usr/lib/gargoyle/switchinfo.sh
	fi
%>
//-->
</script>

<h1 class="page-header"><%~ vlan.Title %></h1>

<div class="row form-group">
	<label class="col-xs-3"><%~ vlan.HWModel %>:</label>
	<span class="col-xs-9" id="hw_model_label"></span>
</div>

<div class="row" id="vlan_unsupported_panel" style="display:none">
	<div class="col-lg-12">
		<div class="alert alert-warning"><%~ vlan.NotSupported %></div>
	</div>
</div>

<div id="vlan_manager_panel">
	<div class="row">
		<div class="col-lg-12">
			<div class="panel panel-default">
				<div class="panel-heading">
					<h3 class="panel-title"><%~ vlan.VlanDefsSect %></h3>
				</div>
				<div class="panel-body">
					<div id="vlan_defs_table_container" class="table-responsive"></div>
					<div class="row form-group">
						<span class="col-xs-2"><input type="text" id="add_vlan_id" class="form-control" oninput="proofreadNumeric(this)" placeholder="<%~ vlan.IdCol %>" size="6" maxlength="4"/></span>
						<span class="col-xs-3"><input type="text" id="add_vlan_name" class="form-control" placeholder="<%~ vlan.NameCol %>"/></span>
						<span class="col-xs-3"><input type="text" id="add_vlan_subnet" class="form-control" placeholder="<%~ vlan.SubnetPlaceholder %>"/></span>
						<span class="col-xs-2">
							<input type="checkbox" id="add_vlan_dhcp" checked="checked"/>
							<label class="short-left-pad" for="add_vlan_dhcp"><%~ vlan.DhcpCol %></label>
						</span>
						<span class="col-xs-2"><button type="button" class="btn btn-default btn-add" onclick="addVlan()"><%~ Add %></button></span>
					</div>
				</div>
			</div>
		</div>
	</div>

	<div class="row">
		<div class="col-lg-12">
			<div class="panel panel-default">
				<div class="panel-heading">
					<h3 class="panel-title"><%~ vlan.PortAssignSect %></h3>
				</div>
				<div class="panel-body">
					<div class="alert alert-info"><%~ vlan.PortAssignHelp %></div>
					<div id="vlan_ports_table_container" class="table-responsive"></div>
				</div>
			</div>
		</div>
	</div>

	<div class="row">
		<div class="col-lg-12">
			<div class="panel panel-default">
				<div class="panel-heading">
					<h3 class="panel-title"><%~ vlan.MatrixSect %></h3>
				</div>
				<div class="panel-body">
					<div class="alert alert-info"><%~ vlan.MatrixHelp %></div>
					<div id="vlan_matrix_table_container" class="table-responsive"></div>
				</div>
			</div>
		</div>
	</div>

	<div class="row">
		<div class="col-lg-12">
			<div class="panel panel-default">
				<div class="panel-heading">
					<h3 class="panel-title"><%~ vlan.PinholeSect %></h3>
				</div>
				<div class="panel-body">
					<div class="alert alert-info"><%~ vlan.PinholeHelp %></div>
					<div id="vlan_pinhole_table_container" class="table-responsive"></div>
					<div class="row form-group">
						<span class="col-xs-2">
							<select id="add_pinhole_src" class="form-control"></select>
						</span>
						<span class="col-xs-3"><input type="text" id="add_pinhole_ip" class="form-control" oninput="proofreadIp(this)" placeholder="<%~ vlan.PinholeIpCol %>"/></span>
						<span class="col-xs-2"><input type="text" id="add_pinhole_port" class="form-control" oninput="proofreadNumeric(this)" placeholder="<%~ vlan.PinholePortCol %> (<%~ vlan.AnyPort %>)"/></span>
						<span class="col-xs-2">
							<select id="add_pinhole_proto" class="form-control">
								<option value="tcp">TCP</option>
								<option value="udp">UDP</option>
							</select>
						</span>
						<span class="col-xs-3"><input type="text" id="add_pinhole_desc" class="form-control" placeholder="<%~ vlan.PinholeDescCol %>"/></span>
					</div>
					<div class="row form-group">
						<div class="col-xs-12"><button type="button" class="btn btn-default btn-add" onclick="addPinhole()"><%~ Add %></button></div>
					</div>
				</div>
			</div>
		</div>
	</div>

	<div class="row form-group">
		<div class="col-lg-12">
			<button type="button" class="btn btn-primary btn-lg" onclick="saveChanges()"><%~ SaveChanges %></button>
		</div>
	</div>
</div>

<%in templates/safe_apply_confirm_template %>

<script>
<!--
	resetData();
//-->
</script>

<%
	gargoyle_header_footer -f -s "connection" -p "vlan"
%>
