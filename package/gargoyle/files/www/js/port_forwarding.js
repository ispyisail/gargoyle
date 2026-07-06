/*
 * This program is copyright © 2008-2013 Eric Bishop and is distributed under the terms of the GNU GPL
 * version 2.0 with a special clarification/exception that permits adapting the program to
 * configure proprietary "back end" software provided that all modifications to the web interface
 * itself remain covered by the GPL.
 * See http://gargoyle-router.com/faq.html#qfoss for more information
 */
var prtS=new Object(); //part of i18n
var TSort_Data = new Array ('portf_table', 's', 's', 'i', 'p', 'i', '');

// Available WAN source zones a forward/open rule can target: the default
// 'wan' zone plus any additive WAN VLAN zone basic.js's WAN VLAN table
// creates (firewall.zone sections named 'wan_vlan<N>'). Both firewall and
// network are already injected into this page (see port_forwarding.sh's
// gargoyle_header_footer package list), so this reads straight out of
// uciOriginal -- no backend change needed. Returns an ordered
// {zoneName: displayLabel} map, 'wan' first. Used both by saveChanges()
// (to key/identify rules by zone) and by the add/edit modals (to populate
// the source-zone dropdown).
function getWanZoneOptionsMap()
{
	var zones = uciOriginal.getAllSectionsOfType("firewall", "zone");
	var found = {};
	for(var i = 0; i < zones.length; i++)
	{
		var zname = uciOriginal.get("firewall", zones[i], "name");
		if(zname == "wan" || zname.match(/^wan_vlan[0-9]+$/) != null)
		{
			var zdesc = uciOriginal.get("network", zname, "gargoyle_desc");
			found[zname] = zdesc ? (zdesc + " (" + zname + ")") : zname;
		}
	}
	if(found["wan"] == null) { found["wan"] = "wan"; }
	var ordered = {};
	ordered["wan"] = found["wan"];
	Object.keys(found).filter(function(n){ return n != "wan"; })
		.sort(function(a,b){ return parseInt(a.replace("wan_vlan",""),10) - parseInt(b.replace("wan_vlan",""),10); })
		.forEach(function(n){ ordered[n] = found[n]; });
	return ordered;
}

function saveChanges()
{
	errorList = proofreadAll();
	if(errorList.length > 0)
	{
		errorString = errorList.join("\n") + "\n\n"+UI.ErrChanges;
		alert(errorString);
	}
	else
	{
		setControlsEnabled(false, true);

		var firewallSectionCommands = [];

		// Match existing firewall redirect/rule sections to current-table
		// rows by their actual identity (source zone + protocol + port(s) +
		// destination -- the same fields this page's own duplicate-rule
		// checks already treat as what makes a rule unique, now that a rule
		// can target any WAN zone, not just 'wan') instead of deleting every
		// section this tab's uciOriginal knows about and rebuilding all of
		// them fresh by row position. The old approach meant any save from
		// this page rewrote every rule wholesale from whatever this tab's
		// own (possibly stale) table showed -- if a second tab had already
		// saved an edit to a rule this tab never touched, that edit got
		// silently reverted the moment this tab saved anything at all (the
		// same corruption class fixed in dhcp.js's saveChanges()). Reusing
		// a matched section lets uci.getScriptCommands()'s normal per-field
		// diff emit commands only for fields a tab actually changed.
		// includeDestInKey: redirect/redirect_disabled rules are unique by
		// protocol+external-port alone (this page's own duplicate check
		// never compares dest_ip/dest_port for these -- two forwards can't
		// share an external port regardless of where they route, so the
		// destination is the "value", not part of the rule's identity).
		// rule/rule_disabled (IPv6 "open port") rules are unique by
		// protocol+dest_port+dest_ip together (this page's own duplicate
		// check *does* compare all three -- the same port can legitimately
		// be opened to several different IPv6 hosts at once).
		function buildRuleIndex(enabledType, disabledType, namePrefix, includeDestInKey)
		{
			var byKey = {};
			var maxIdx = { enabled: -1, disabled: -1 };
			[[enabledType, true], [disabledType, false]].forEach(function(pair)
			{
				var secType = pair[0];
				var isEnabled = pair[1];
				var secs = uciOriginal.getAllSectionsOfType("firewall", secType);
				for(var i = 0; i < secs.length; i++)
				{
					var secName = secs[i];
					if(namePrefix != null && secName.indexOf(namePrefix) != 0) { continue; }
					var proto = uciOriginal.get("firewall", secName, "proto");
					var srcdport = uciOriginal.get("firewall", secName, "src_dport");
					var srczone = uciOriginal.get("firewall", secName, "src") || "wan";
					var key = srczone + "|" + (proto||"") + "|" + (srcdport||"");
					if(includeDestInKey)
					{
						var destip = uciOriginal.get("firewall", secName, "dest_ip");
						var destport = uciOriginal.get("firewall", secName, "dest_port");
						key = key + "|" + (destip||"") + "|" + (destport||"");
					}
					byKey[key] = { name: secName, enabled: isEnabled };
					var m = secName.match(/_(\d+)$/);
					if(m != null)
					{
						var idx = parseInt(m[1], 10);
						if(isEnabled) { maxIdx.enabled = Math.max(maxIdx.enabled, idx); }
						else { maxIdx.disabled = Math.max(maxIdx.disabled, idx); }
					}
				}
			});
			return { byKey: byKey, maxIdx: maxIdx, matched: {} };
		}

		// Resolve the section to write a row's fields to: reuse an existing
		// match if the rule's identity AND enabled/disabled state are
		// unchanged; otherwise allocate a new name (a real toggle or a
		// genuinely new rule -- both are actions this tab is intentionally
		// taking on this specific rule, not a stale-data hazard against an
		// unrelated one).
		function resolveRuleSection(index, key, wantEnabled, enabledType, disabledType, namePrefix, uci)
		{
			var existing = index.byKey[key];
			if(existing != null && existing.enabled == wantEnabled)
			{
				index.matched[existing.name] = true;
				return existing.name;
			}
			if(existing != null)
			{
				// same rule, toggled enabled/disabled -- old name goes away
				index.matched[existing.name] = true;
				uciOriginal.removeSection("firewall", existing.name);
				uci.removeSection("firewall", existing.name);
				firewallSectionCommands.push("uci del firewall." + existing.name);
			}
			var slot = wantEnabled ? "enabled" : "disabled";
			var nextIdx = wantEnabled ? ++index.maxIdx.enabled : ++index.maxIdx.disabled;
			var newName = namePrefix + slot + "_number_" + nextIdx;
			uci.set("firewall", newName, "", wantEnabled ? enabledType : disabledType);
			firewallSectionCommands.push("uci set firewall." + newName + "=" + (wantEnabled ? enabledType : disabledType));
			return newName;
		}

		var redirectIndex = buildRuleIndex("redirect", "redirect_disabled", "redirect_", false);
		var openIndex = buildRuleIndex("rule", "rule_disabled", "portopen_rule_", true);

		var uci = uciOriginal.clone();


		var singlePortTable = document.getElementById('portf_table_container').firstChild;
		var singlePortData= getTableDataArray(singlePortTable, true, false);
		for(rowIndex = 0; rowIndex < singlePortData.length; rowIndex++)
		{

			var rowData = singlePortData[rowIndex];
			var enabled = rowData[6].checked;

			var protos = rowData[1].toLowerCase() == UI.both.toLowerCase() ? ["tcp", "udp"] : [ rowData[1].toLowerCase() ];
			var protoIndex=0;
			for(protoIndex=0;protoIndex < protos.length; protoIndex++)
			{
				var key = rowData[5] + "|" + protos[protoIndex] + "|" + rowData[2];
				var id = resolveRuleSection(redirectIndex, key, enabled, "redirect", "redirect_disabled", "redirect_", uci);
				uci.set("firewall", id, "name", rowData[0]);
				uci.set("firewall", id, "src", rowData[5]);
				uci.set("firewall", id, "dest", "lan");
				uci.set("firewall", id, "family", "ipv4");
				uci.set("firewall", id, "proto", protos[protoIndex]);
				uci.set("firewall", id, "src_dport", rowData[2]);
				uci.set("firewall", id, "dest_ip", rowData[3]);
				uci.set("firewall", id, "dest_port", rowData[4]);
			}
		}


		var portRangeTable = document.getElementById('portfrange_table_container').firstChild;
		var portRangeData= getTableDataArray(portRangeTable, true, false);
		for(rowIndex = 0; rowIndex < portRangeData.length; rowIndex++)
		{
			var rowData = portRangeData[rowIndex];
			var enabled = rowData[6].checked;

			var protos = rowData[1].toLowerCase() == UI.both.toLowerCase() ? ["tcp", "udp"] : [ rowData[1].toLowerCase() ];
			var protoIndex=0;
			for(protoIndex=0;protoIndex < protos.length; protoIndex++)
			{
				var srcdport = rowData[2] + "-" + rowData[3];
				var key = rowData[5] + "|" + protos[protoIndex] + "|" + srcdport;
				var id = resolveRuleSection(redirectIndex, key, enabled, "redirect", "redirect_disabled", "redirect_", uci);
				uci.set("firewall", id, "name", rowData[0]);
				uci.set("firewall", id, "src", rowData[5]);
				uci.set("firewall", id, "dest", "lan");
				uci.set("firewall", id, "family", "ipv4");
				uci.set("firewall", id, "proto", protos[protoIndex]);
				uci.set("firewall", id, "src_dport", srcdport);
				uci.set("firewall", id, "dest_port", srcdport);
				uci.set("firewall", id, "dest_ip", rowData[4]);
			}
		}


		//dmz -- a singleton, not a list, so no multi-tab identity-matching
		//needed here; just make sure disabling it actually removes the
		//section now that the old unconditional "delete every firewall
		//section this tab knows about" loop above is gone.
		var dmzSections = uciOriginal.getAllSectionsOfType("firewall", "dmz");
		if(document.getElementById('dmz_enabled').checked )
		{
			var id = "dmz";
			firewallSectionCommands.push("uci firewall.dmz=dmz" );

			uci.set("firewall", id, "", "dmz");
			uci.set("firewall", id, "from", "wan");
			uci.set("firewall", id, "to_ip", document.getElementById('dmz_ip').value);
		}
		else
		{
			for(var dmzIdx = 0; dmzIdx < dmzSections.length; dmzIdx++)
			{
				uciOriginal.removeSection("firewall", dmzSections[dmzIdx]);
				uci.removeSection("firewall", dmzSections[dmzIdx]);
				firewallSectionCommands.push("uci del firewall." + dmzSections[dmzIdx]);
			}
		}

		firewallSectionCommands.push("uci commit");

		restartFirewallCommand = "\nsh /usr/lib/gargoyle/restart_firewall.sh ;\n";


		//upnp
		upnpStartCommands = new Array();
		if(haveUpnpd)
		{
			upnpdEnabled = document.getElementById("upnp_enabled").checked;
			if(upnpdEnabled)
			{
				upnpStartCommands.push("/etc/init.d/miniupnpd enable");
				uci.set("upnpd", "config", "enabled", "1");
				uci.set("upnpd", "config", "enable_upnp", "1");
				uci.set("upnpd", "config", "enable_natpmp", "1");
				uci.set("upnpd", "config", "upload", document.getElementById("upnp_up").value);
				uci.set("upnpd", "config", "download", document.getElementById("upnp_down").value);
			}
			else
			{
				uci.set("upnpd", "config", "enabled", "0");
				uci.set("upnpd", "config", "enable_upnp", "0");
				uci.set("upnpd", "config", "enable_natpmp", "0");
				upnpStartCommands.push("/etc/init.d/miniupnpd disable");
			}
		}

		singlePortTable = document.getElementById('porto_table_container').firstChild;
		singlePortData= getTableDataArray(singlePortTable, true, false);
		for(rowIndex = 0; rowIndex < singlePortData.length; rowIndex++)
		{
			var rowData = singlePortData[rowIndex];
			var enabled = rowData[5].checked;

			var protos = rowData[1].toLowerCase() == UI.both.toLowerCase() ? ["tcp", "udp"] : [ rowData[1].toLowerCase() ];
			var protoIndex=0;
			for(protoIndex=0;protoIndex < protos.length; protoIndex++)
			{
				var key = rowData[4] + "|" + protos[protoIndex] + "||" + rowData[2] + "|" + rowData[3];
				var id = resolveRuleSection(openIndex, key, enabled, "rule", "rule_disabled", "portopen_rule_", uci);
				uci.set("firewall", id, "name", rowData[0]);
				uci.set("firewall", id, "src", rowData[4]);
				uci.set("firewall", id, "dest", "lan");
				uci.set("firewall", id, "family", "ipv6");
				uci.set("firewall", id, "target", "ACCEPT");
				uci.set("firewall", id, "proto", protos[protoIndex]);
				uci.set("firewall", id, "dest_ip", rowData[2]);
				uci.set("firewall", id, "dest_port", rowData[3]);
			}
		}

		portRangeTable = document.getElementById('portorange_table_container').firstChild;
		portRangeData= getTableDataArray(portRangeTable, true, false);
		for(rowIndex = 0; rowIndex < portRangeData.length; rowIndex++)
		{
			var rowData = portRangeData[rowIndex];
			var enabled = rowData[6].checked;

			var protos = rowData[1].toLowerCase() == UI.both.toLowerCase() ? ["tcp", "udp"] : [ rowData[1].toLowerCase() ];
			var protoIndex=0;
			for(protoIndex=0;protoIndex < protos.length; protoIndex++)
			{
				var destport = rowData[2] + "-" + rowData[3];
				var key = rowData[5] + "|" + protos[protoIndex] + "||" + rowData[4] + "|" + destport;
				var id = resolveRuleSection(openIndex, key, enabled, "rule", "rule_disabled", "portopen_rule_", uci);
				uci.set("firewall", id, "name", rowData[0]);
				uci.set("firewall", id, "src", rowData[5]);
				uci.set("firewall", id, "dest", "lan");
				uci.set("firewall", id, "family", "ipv6");
				uci.set("firewall", id, "target", "ACCEPT");
				uci.set("firewall", id, "proto", protos[protoIndex]);
				uci.set("firewall", id, "dest_ip", rowData[4]);
				uci.set("firewall", id, "dest_port", rowData[2] + "-" + rowData[3]);
			}
		}

		// Any section either index knew about that no current row still
		// maps to (by identity) was actually removed by the user in this
		// tab -- delete only those, not every section wholesale.
		[redirectIndex, openIndex].forEach(function(index)
		{
			Object.keys(index.byKey).forEach(function(key)
			{
				var entry = index.byKey[key];
				if(index.matched[entry.name] == null)
				{
					uciOriginal.removeSection("firewall", entry.name);
					uci.removeSection("firewall", entry.name);
					firewallSectionCommands.push("uci del firewall." + entry.name);
				}
			});
		});

		commands = firewallSectionCommands.join("\n") + "\n" + uci.getScriptCommands(uciOriginal) + "\n" + upnpStartCommands.join("\n") + "\n" + restartFirewallCommand;
		var param = getParameterDefinition("commands", commands) + "&" + getParameterDefinition("hash", document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, ""));

		var stateChangeFunction = function(req)
		{
			if(req.readyState == 4)
			{
				uciOriginal = uci.clone();
				resetData();
				setControlsEnabled(true);
			}
		}
		runAjax("POST", "utility/run_commands.sh", param, stateChangeFunction);
	}
}

function proofreadAll()
{
	controlIds=['dmz_ip', 'upnp_up', 'upnp_down'];
	labelIds= ['dmz_ip_label', 'upnp_up_label', 'upnp_down_label'];
	functions = [validateIP, validateNumeric, validateNumeric];
	returnCodes = [0,0,0];
	visibilityIds=controlIds;
	errors = proofreadFields(controlIds, labelIds, functions, returnCodes, visibilityIds);
	return errors;
}

function addPortfRule()
{
	errors = proofreadForwardSingle();
	if(errors.length > 0)
	{
		alert(errors.join("\n") + "\n\n"+prtS.AFRErr);
	}
	else
	{
		values = new Array();
		ids = ['add_desc', 'add_prot', 'add_fp', 'add_ip', 'add_dp', 'add_src_zone'];
		for (idIndex in ids)
		{
			element = document.getElementById(ids[idIndex]);
			v = element.value;
			v = v== '' ? '-' : v;
			values.push(v);
			if(element.type == "text")
			{
				element.value = "";
			}
		}
		values[4] = values[4] == '-' ? values[2] : values[4];


		//check if this is identical to another rule, but for a different protocol
		//if so, just merge the two by setting the protocol on the old data to 'both'
		//
		portfTable = document.getElementById('portf_table_container').firstChild;
		currentPortfData = getTableDataArray(portfTable, true, false);
		otherProto = values[1] == 'TCP' ? 'UDP' : 'TCP';
		mergedWithExistingRule = false;
		for (rowDataIndex in currentPortfData)
		{
			rowData = currentPortfData[rowDataIndex];

			if( otherProto == rowData[1] &&  values[2] == rowData[2] && values[3] == rowData[3] && values[4] == rowData[4] && values[5] == rowData[5])
			{

				portfTable.rows[(rowDataIndex*1)+1].childNodes[1].firstChild.data = UI.both;
				if(values[0] != '-' && rowData[0] == '-')
				{
					portfTable.rows[(rowDataIndex*1)+1].childNodes[0].firstChild.data = values[0];
				}

				table1Container = document.getElementById('portf_table_container');
				if(table1Container.firstChild != null)
				{
					table1Container.removeChild(table1Container.firstChild);
				}
				table1Container.appendChild(portfTable);

				mergedWithExistingRule = true;
			}
		}

		if(!mergedWithExistingRule)
		{
			checkbox = createInput('checkbox');
			checkbox.checked = true;
			values.push(checkbox);
			values.push(createEditButton(true, "forward"));
			addTableRow(portfTable,values, true, false);
		}
		closeModalWindow('single_forward_modal');
	}
}



function addPortfRangeRule()
{
	errors = proofreadForwardRange();
	if(errors.length > 0)
	{
		alert(errors.join("\n") + "\n\n"+prtS.AFRErr);
	}
	else
	{
		values = new Array();
		ids = ['addr_desc', 'addr_prot', 'addr_sp', 'addr_ep', 'addr_ip', 'addr_src_zone'];
		for (idIndex in ids)
		{
			element = document.getElementById(ids[idIndex]);
			v = element.value;
			v = v== '' ? '-' : v;
			values.push(v);
			if(element.type == 'text')
			{
				element.value = "";
			}
		}

		portfRangeTable = document.getElementById('portfrange_table_container').firstChild;
		currentRangeData = getTableDataArray(portfRangeTable, true, false);
		otherProto = values[1] == 'TCP' ? 'UDP' : 'TCP';
		mergedWithExistingRule = false;
		for (rowDataIndex in currentRangeData)
		{
			rowData = currentRangeData[rowDataIndex];
			if( otherProto == rowData[1] &&  values[2] == rowData[2] && values[3] == rowData[3] && values[4] == rowData[4] && values[5] == rowData[5])
			{
				portfRangeTable.rows[(rowDataIndex*1)+1].childNodes[1].firstChild.data = UI.both;
				if(values[0] != '-' && rowData[0] == '-')
				{
					portfRangeTable.rows[(rowDataIndex*1)+1].childNodes[0].firstChild.data = values[0];
				}

				table2Container = document.getElementById('portfrange_table_container');
				if(table2Container.firstChild != null)
				{
					table2Container.removeChild(table2Container.firstChild);
				}
				table2Container.appendChild(portfRangeTable);

				mergedWithExistingRule = true;

			}
		}


		if(!mergedWithExistingRule)
		{
			checkbox = createInput('checkbox');
			checkbox.checked = true;
			values.push(checkbox);
			values.push(createEditButton(false, "forward"));

			portfrangeTable = document.getElementById('portfrange_table_container').firstChild;
			addTableRow(portfrangeTable,values, true, false);
		}
		closeModalWindow('multi_forward_modal');
	}
}

function proofreadForwardRange(excludeRow)
{
	var addIds = ['addr_sp', 'addr_ep', 'addr_ip'];
	var labelIds = ['addr_sp_label', 'addr_ep_label', 'addr_ip_label'];
	var functions = [validateNumeric, validateNumeric, validateIP];
	var returnCodes = [0,0,0];
	var visibilityIds = addIds;
	var errors = proofreadFields(addIds, labelIds, functions, returnCodes, visibilityIds, document);
	if(errors.length == 0)
	{
		if( (1*document.getElementById('addr_sp').value) > (1*document.getElementById('addr_ep').value) )
		{
			errors.push(prtS.GTErr);
		}


		var portfTable = document.getElementById('portf_table_container').firstChild;
		var currentPortfData = getTableDataArray(portfTable, true, false);
		var addStartPort = document.getElementById('addr_sp').value;
		var addEndPort = document.getElementById('addr_ep').value;
		var addProtocol = document.getElementById('addr_prot').value;
		var addZone = document.getElementById('addr_src_zone').value;
		var rowDataIndex=0;
		for (rowDataIndex=0; rowDataIndex < currentPortfData.length ; rowDataIndex++)
		{
			var rowData = currentPortfData[rowDataIndex];
			if( (addProtocol == rowData[1] || addProtocol == UI.both || rowData[1] == UI.both) &&  addStartPort*1 <= rowData[2]*1 && addEndPort*1 >= rowData[2]*1 && addZone == rowData[5])
			{
				errors.push(prtS.DupErr);
			}
		}

		var portfRangeTable = document.getElementById('portfrange_table_container').firstChild;
		var currentRangeData = getTableDataArray(portfRangeTable, true, false);
		for (rowDataIndex=0; rowDataIndex < currentRangeData.length; rowDataIndex++)
		{
			if(portfRangeTable.rows[rowDataIndex+1] != excludeRow)
			{
				var rowData = currentRangeData[rowDataIndex];
				if( (addProtocol == rowData[1] || addProtocol == UI.both || rowData[1] == UI.both) && rowData[2]*1 <= addEndPort*1 && rowData[3]*1 >= addStartPort*1 && addZone == rowData[5])
				{
					errors.push(prtS.DupErr);
				}
			}
		}
	}


	return errors;

}

function proofreadForwardSingle(excludeRow)
{
	var addIds = ['add_fp', 'add_ip'];
	var labelIds = ['add_fp_label', 'add_ip_label', 'add_dp_label'];
	var functions = [validateNumeric, validateIP, validateNumeric];
	var returnCodes = [0,0,0];
	var visibilityIds = addIds;
	if(document.getElementById('add_dp').value.length > 0)
	{
		addIds.push('add_dp');
	}
	var errors = proofreadFields(addIds, labelIds, functions, returnCodes, visibilityIds, document);



	if(errors.length == 0)
	{
		var portfTable = document.getElementById('portf_table_container').firstChild;
		var currentPortfData = getTableDataArray(portfTable, true, false);
		var addPort = document.getElementById('add_fp').value;
		var addProtocol = document.getElementById('add_prot').value;
		var addZone = document.getElementById('add_src_zone').value;
		var rowDataIndex=0;
		for (rowDataIndex=0; rowDataIndex < currentPortfData.length; rowDataIndex++)
		{
			if(portfTable.rows[rowDataIndex+1] != excludeRow)
			{
				var rowData = currentPortfData[rowDataIndex];
				if( (addProtocol == rowData[1] || addProtocol == UI.both || rowData[1] == UI.both) &&  addPort == rowData[2] && addZone == rowData[5])
				{
					errors.push(prtS.CopErr);
				}
			}
		}

		var portfRangeTable = document.getElementById('portfrange_table_container').firstChild;
		var currentRangeData = getTableDataArray(portfRangeTable, true, false);
		for (rowDataIndex=0; rowDataIndex < currentRangeData.length; rowDataIndex++)
		{
			var rowData = currentRangeData[rowDataIndex];
			if( (addProtocol == rowData[1] || addProtocol == UI.both || rowData[1] == UI.both) && rowData[2]*1 <= addPort*1 && rowData[3]*1 >= addPort*1 && addZone == rowData[5])
			{
				errors.push(prtS.CopErr);
			}
		}
	}

	return errors;
}

function resetData()
{
	var singlePortTableData = new Array();
	var portRangeTableData = new Array();
	var singlePortEnabledStatus = new Array();
	var portRangeEnabledStatus = new Array();
	var dmzIp = "";

	var singlePortProtoHash = [];
	var portRangeProtoHash = [];
	singlePortProtoHash["tcp"] = [];
	singlePortProtoHash["udp"] = [];
	portRangeProtoHash["tcp"] = [];
	portRangeProtoHash["udp"] = [];


	// parse (both enabled & disabled) redirects
	// uci firewall doesn't parse redirect_disabled sections, so we can store this info there
	// without any complications.  Likewise we store rule name in "name" variable that doesn't
	// get parsed by the uci firewall script.
	var redirectSectionTypes = ["redirect", "redirect_disabled"];
	for(typeIndex=0; typeIndex < redirectSectionTypes.length; typeIndex++)
	{
		var sectionType = redirectSectionTypes[typeIndex];
		var redirectSections = uciOriginal.getAllSectionsOfType("firewall", redirectSectionTypes[typeIndex]);
		for(rdIndex=0; rdIndex < redirectSections.length; rdIndex++)
		{
			var rId = redirectSections[rdIndex];
			var name = uciOriginal.get("firewall", rId, "name");
			name = name == "" ? "-" : name;
			var proto	= uciOriginal.get("firewall", rId, "proto").toLowerCase();
			var srcdport	= uciOriginal.get("firewall", rId, "src_dport");
			var destip	= uciOriginal.get("firewall", rId, "dest_ip");
			var destport	= uciOriginal.get("firewall", rId, "dest_port");
			var srczone	= uciOriginal.get("firewall", rId, "src");
			srczone = srczone == "" ? "wan" : srczone;


			if(srcdport == "" && destport == "" && sectionType == "redirect")
			{
				dmzIp = dmzIp == "" ? destip : dmzIp;
			}
			else if(proto.toLowerCase() == "tcp" || proto.toLowerCase() == "udp")
			{
				checkbox = createInput('checkbox');
				checkbox.checked = sectionType == "redirect" ? true : false;

				destport = destport == "" ? srcdport : destport;
				otherProto = proto == "tcp" ? "udp" : "tcp";
				hashStr = name + "-" + srcdport + "-" + destip + "-" + destport + "-" + srczone;
				if(srcdport.match(/-/))
				{
					var splitPorts = srcdport.split(/-/);
					// if same rule, different protocol exists, merge into one rule
					// otherwise, add rule to table data
					if(portRangeProtoHash[otherProto][hashStr] != null)
					{
						portRangeProtoHash[otherProto][hashStr][1] = UI.both;
					}
					else
					{
						var nextTableRowData = [name, proto.toUpperCase(), splitPorts[0], splitPorts[1], destip, srczone, checkbox, createEditButton(false,"forward")];
						portRangeTableData.push(nextTableRowData);
						portRangeProtoHash[proto][hashStr] = nextTableRowData;
						portRangeEnabledStatus.push(checkbox.checked);
					}
				}
				else
				{
					// if same rule, different protocol exists, merge into one rule
					// otherwise, add rule to table data
					if(singlePortProtoHash[otherProto][hashStr] != null)
					{
						singlePortProtoHash[otherProto][hashStr][1] = UI.both;
					}
					else
					{
						var nextTableRowData = [name, proto.toUpperCase(), srcdport, destip, destport, srczone, checkbox, createEditButton(true,"forward")];
						singlePortTableData.push(nextTableRowData);
						singlePortProtoHash[proto][hashStr] = nextTableRowData;
						singlePortEnabledStatus.push(checkbox.checked);
					}
				}
			}
		}
	}


	columnNames = [prtS.Desc, prtS.Proto, prtS.FPrt, prtS.TIP, prtS.TPrt, prtS.SrcZone, UI.Enabled, '']
	portfTable=createTable(columnNames, singlePortTableData, "portf_table", true, false);
	table1Container = document.getElementById('portf_table_container');

	if(table1Container.firstChild != null)
	{
		table1Container.removeChild(table1Container.firstChild);
	}
	table1Container.appendChild(portfTable);





	columnNames = [prtS.Desc, prtS.Proto, prtS.SPrt, prtS.EPrt, prtS.TIP, prtS.SrcZone, UI.Enabled, '']
	portfrangeTable=createTable(columnNames, portRangeTableData, "portf_range_table", true, false);
	table2Container = document.getElementById('portfrange_table_container');
	if(document.getElementById('portfrange_table_container').firstChild != null)
	{
		table2Container.removeChild(table2Container.firstChild);
	}
	table2Container.appendChild(portfrangeTable);



	// Because IE6 was designed by programmers whose only qualification was participation in the Special Olympics,
	// checkboxes become unchecked when added to table.  We need to reset checked status here.
	for(spIndex = 0; spIndex < singlePortEnabledStatus.length; spIndex++)
	{
		singlePortTableData[spIndex][6].checked = singlePortEnabledStatus[spIndex];
	}
	for(prIndex = 0; prIndex < portRangeEnabledStatus.length; prIndex++)
	{
		portRangeTableData[prIndex][6].checked = portRangeEnabledStatus[prIndex];
	}



	clearIds = ['add_desc', 'add_fp', 'add_ip', 'add_dp', 'addr_desc', 'addr_sp', 'addr_ep', 'addr_ip'];
	for(clearIndex = 0; clearIndex < clearIds.length; clearIndex++)
	{
		document.getElementById(clearIds[clearIndex]).value = '';
	}


	//dmz
	var dmzSections = uciOriginal.getAllSectionsOfType("firewall", "dmz");
	document.getElementById("dmz_enabled").checked = (dmzSections.length > 0);
	if( dmzSections.length > 0)
	{
		document.getElementById("dmz_ip").value = uciOriginal.get("firewall", dmzSections[0], "to_ip");
	}
	else
	{
		var defaultDmz = (currentLanIp.split(/\.[^\.]*$/))[0];
		var lanIpEnd = parseInt((currentLanIp.split("."))[3]);
		if(lanIpEnd >= 254)
		{
			lanIpEnd--;
		}
		else
		{
			lanIpEnd++;
		}
		defaultDmz = defaultDmz + "." + lanIpEnd;
		document.getElementById("dmz_ip").value = defaultDmz;
	}
	setDmzEnabled();


	//upnp
	document.getElementById("upnp_no_miniupnpd").style.display = haveUpnpd == true ? "none" : "block";
	document.getElementById("upnp_enabled").disabled = haveUpnpd == true ? false : true;
	document.getElementById("upnp_enabled").checked = upnpdEnabled;
	upElement = document.getElementById("upnp_up");
	downElement = document.getElementById("upnp_down");

	upElement.value = uciOriginal.get("upnpd", "config", "upload");
	upElement.value = upElement.value == '' ? 1250 : upElement.value;

	downElement.value = uciOriginal.get("upnpd", "config", "download");
	downElement.value = downElement.value == '' ? 1250 : downElement.value;

	setUpnpEnabled();
	initializeDescriptionVisibility(uciOriginal, "upnp_help");
	uciOriginal.removeSection("gargoyle", "help");


	if (upnpdEnabled) {
		update_upnp();
		timerid=setInterval("update_upnp()", 10000);
	} else {
		clearInterval(timerid);
		timerid = null;

		var tableData = new Array();
		var tableRow =['***','***********','*****','*****'];
		tableData.push(tableRow);

		var columnNames= [prtS.Prot, prtS.LHst, prtS.Port, prtS.EPort ];
		var upnpTable = createTable(columnNames, tableData, "upnp_table", false, false);
		var tableContainer = document.getElementById('upnp_table_container');
		if(tableContainer.firstChild != null)
		{
			tableContainer.removeChild(tableContainer.firstChild);
		}
		tableContainer.appendChild(upnpTable);


	}

	singlePortTableData = new Array();
	singlePortEnabledStatus = new Array();
	portRangeTableData = new Array();
	portRangeEnabledStatus = new Array();
	singlePortProtoHash["tcp"] = [];
	singlePortProtoHash["udp"] = [];
	portRangeProtoHash["tcp"] = [];
	portRangeProtoHash["udp"] = [];
	// parse (both enabled & disabled) port open rules
	// uci firewall doesn't parse rule_disabled sections, so we can store this info there
	// without any complications.  Likewise we store rule name in "name" variable that doesn't
	// get parsed by the uci firewall script.
	var redirectSectionTypes = ["rule", "rule_disabled"];
	for(typeIndex=0; typeIndex < redirectSectionTypes.length; typeIndex++)
	{
		var sectionType = redirectSectionTypes[typeIndex];
		var portopenSections = uciOriginal.getAllSectionsOfType("firewall", redirectSectionTypes[typeIndex]);
		for(poIndex=0; poIndex < portopenSections.length; poIndex++)
		{
			var poId = portopenSections[poIndex];
			var match = poId.match("^portopen_rule_(en|dis)abled");
			if(match == null)
			{
				continue;
			}
			
			var name = uciOriginal.get("firewall", poId, "name");
			name = name == "" ? "-" : name;
			var proto	= uciOriginal.get("firewall", poId, "proto").toLowerCase();
			var destip	= uciOriginal.get("firewall", poId, "dest_ip");
			var destport	= uciOriginal.get("firewall", poId, "dest_port");
			var srczone	= uciOriginal.get("firewall", poId, "src");
			srczone = srczone == "" ? "wan" : srczone;


			if(proto.toLowerCase() == "tcp" || proto.toLowerCase() == "udp")
			{
				checkbox = createInput('checkbox');
				checkbox.checked = sectionType == "rule" ? true : false;

				otherProto = proto == "tcp" ? "udp" : "tcp";
				hashStr = name + "-" + destip + "-" + destport + "-" + srczone;
				if(destport.match(/-/))
				{
					var splitPorts = destport.split(/-/);
					// if same rule, different protocol exists, merge into one rule
					// otherwise, add rule to table data
					if(portRangeProtoHash[otherProto][hashStr] != null)
					{
						portRangeProtoHash[otherProto][hashStr][1] = UI.both;
					}
					else
					{
						var nextTableRowData = [name, proto.toUpperCase(), splitPorts[0], splitPorts[1], destip, srczone, checkbox, createEditButton(false,"open")];
						portRangeTableData.push(nextTableRowData);
						portRangeProtoHash[proto][hashStr] = nextTableRowData;
						portRangeEnabledStatus.push(checkbox.checked);
					}
				}
				else
				{
					// if same rule, different protocol exists, merge into one rule
					// otherwise, add rule to table data
					if(singlePortProtoHash[otherProto][hashStr] != null)
					{
						singlePortProtoHash[otherProto][hashStr][1] = UI.both;
					}
					else
					{
						var nextTableRowData = [name, proto.toUpperCase(), destip, destport, srczone, checkbox, createEditButton(true,"open")];
						singlePortTableData.push(nextTableRowData);
						singlePortProtoHash[proto][hashStr] = nextTableRowData;
						singlePortEnabledStatus.push(checkbox.checked);
					}
				}
			}
		}
	}


	columnNames = [prtS.Desc, prtS.Proto, "IP", prtS.Port, prtS.SrcZone, UI.Enabled, '']
	portoTable=createTable(columnNames, singlePortTableData, "porto_table", true, false);
	table1Container = document.getElementById('porto_table_container');

	if(table1Container.firstChild != null)
	{
		table1Container.removeChild(table1Container.firstChild);
	}
	table1Container.appendChild(portoTable);

	columnNames = [prtS.Desc, prtS.Proto, prtS.SPrt, prtS.EPrt, prtS.TIP, prtS.SrcZone, UI.Enabled, '']
	portorangeTable=createTable(columnNames, portRangeTableData, "porto_range_table", true, false);
	table2Container = document.getElementById('portorange_table_container');
	if(document.getElementById('portorange_table_container').firstChild != null)
	{
		table2Container.removeChild(table2Container.firstChild);
	}
	table2Container.appendChild(portorangeTable);
}

function setUpnpEnabled()
{
	enableAssociatedField(document.getElementById("upnp_enabled"), 'upnp_up', document.getElementById('upnp_up').value);
	enableAssociatedField(document.getElementById("upnp_enabled"), 'upnp_down', document.getElementById('upnp_down').value);
}

function setDmzEnabled()
{
	enableAssociatedField(document.getElementById("dmz_enabled"), 'dmz_ip', document.getElementById('dmz_ip').value);
}


function createEditButton(isSingle, forwardopen)
{
	var editButton = createInput("button");
	editButton.textContent = UI.Edit;
	editButton.className = "btn btn-default btn-edit";
	if(forwardopen == "forward")
	{
		editButton.onclick = isSingle ? function(){editPortFModal(true, this)} : function(){editPortFModal(false, this)};
	}
	else
	{
		editButton.onclick = isSingle ? function(){editPortOModal(true, this)} : function(){editPortOModal(false, this)};
	}
	return editButton;
}

function editForward(isSingle, editRow)
{
	//set edit values
	var r= isSingle ? "" : "r";

	var errors;
	if(isSingle)
	{
		errors = proofreadForwardSingle(editRow);
	}
	else
	{
		errors = proofreadForwardRange(editRow);
	}
	if(errors.length > 0)
	{
		alert(errors.join("\n") + "\n"+prtS.UpErr);
	}
	else
	{
		//update document with new data
		editRow.childNodes[0].firstChild.data = document.getElementById("add" + r + "_desc").value;
		editRow.childNodes[1].firstChild.data = getSelectedValue( "add" + r + "_prot", document );
		if(isSingle)
		{
			editRow.childNodes[2].firstChild.data = document.getElementById("add_fp").value;
			editRow.childNodes[3].firstChild.data = document.getElementById("add_ip").value;
			editRow.childNodes[4].firstChild.data = document.getElementById("add_dp").value;
		}
		else
		{
			editRow.childNodes[2].firstChild.data = document.getElementById("addr_sp").value;
			editRow.childNodes[3].firstChild.data = document.getElementById("addr_ep").value;
			editRow.childNodes[4].firstChild.data = document.getElementById("addr_ip").value;
		}
		editRow.childNodes[5].firstChild.data = getSelectedValue( "add" + r + "_src_zone", document );
		closeModalWindow(isSingle ? "single_forward_modal" : "multi_forward_modal");
	}
}

var updateInProgress=false;
var timerid=null;

function update_upnp()
{
	if (!updateInProgress)
	{
		updateInProgress = true;
		var commands=['nft list chain inet fw4 upnp_prerouting 2>/dev/null | grep "dnat"','nft list chain inet fw4 upnp_forward 2>/dev/null | grep "nh,192,128"']
		var param = getParameterDefinition("commands", commands.join('\n')) + "&" + getParameterDefinition("hash", document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, ""));

		var stateChangeFunction = function(req)
		{
			if(req.readyState == 4)
			{
				var lines = req.responseText.split("\n");
				var tableData = new Array();
				var i;
				var upnpcnt=0;

				if (lines != null)
				{
					for(i = 0; i < lines.length; i++)
					{
						var upnd = lines[i].split(/\s+/);
						if(lines[i].indexOf('dnat') > -1)
						{
							// IPv4
							var upnpd = lines[i].match(/iif ".*" @nh,72,8 0x([0-9A-F]+) th dport ([0-9]+) dnat ip to ([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}):([0-9]+)/i);
							if(upnpd.length == 5)
							{
								var tableRow = [upnpd[1] == '6' ? 'TCP' : 'UDP', upnpd[3], upnpd[4], upnpd[2]];
								tableData.push(tableRow);
								upnpcnt = upnpcnt+1;
							}
						}
						else if(lines[i].indexOf('@nh,192,128') > -1)
						{
							// IPv6
							var upnpd = lines[i].match(/iif ".*" th dport ([0-9]+) th sport ([0-9]+) @nh,192,128 0x([0-9A-F]+) @nh,64,128 0x0 @nh,48,8 0x([0-9A-F]+)/i);
							if(upnpd.length == 5)
							{
								var ip6 = upnpd[3].match(/.{4}/g);
								if(ip6.length == 8)
								{
									ip6 = ip6_canonical(ip6.join(':'));
									var tableRow = [upnpd[4] == '6' ? 'TCP' : 'UDP', ip6, upnpd[1], upnpd[2]];
									tableData.push(tableRow);
									upnpcnt = upnpcnt+1;
								}
							}
						}
					}
				}

				//Always display at least on blank line
				if (upnpcnt == 0 ) {
					var tableRow =['***','***********','*****','*****'];
					tableData.push(tableRow);
				}

				var columnNames= [prtS.Prot, prtS.LHst, prtS.Port, prtS.EPort ];

				var upnpTable = createTable(columnNames, tableData, "upnp_table", false, false);
				var tableContainer = document.getElementById('upnp_table_container');
				if(tableContainer.firstChild != null)
				{
					tableContainer.removeChild(tableContainer.firstChild);
				}
				tableContainer.appendChild(upnpTable);


				updateInProgress = false;
			}
		}

		runAjax("POST", "utility/run_commands.sh", param, stateChangeFunction);
	}
}

function addPortFModal(isSingle)
{
	modalButtons = [
		{"title" : UI.Add, "classes" : "btn btn-primary", "function" : isSingle ? addPortfRule : addPortfRangeRule},
		"defaultDismiss"
	];

	var desc = "";
	var prot = "both";
	if(isSingle)
	{
		var fp = "";
		var dp = "";
	}
	else
	{
		var sp = "";
		var ep = "";
	}
	var ip = "";

	var r = isSingle ? "" : "r";
	modalElements = [
		{"id" : "add" + r + "_desc", "value" : desc},
		{"id" : "add" + r + "_prot", "value" : prot},
		{"id" : "add" + r + "_ip", "value" : ip},
		{"id" : "add" + r + "_src_zone", "options" : getWanZoneOptionsMap(), "value" : "wan"}
	];
	if(isSingle)
	{
		modalElements.push(
			{"id" : "add_fp", "value" : fp},
			{"id" : "add_dp", "value" : dp}
		);
	}
	else
	{
		modalElements.push(
			{"id" : "addr_sp", "value" : sp},
			{"id" : "addr_ep", "value" : ep}
		);
	}

	modalPrepare(isSingle ? 'single_forward_modal' : 'multi_forward_modal', isSingle ? prtS.ForIPort : prtS.ForRPort, modalElements, modalButtons);
	openModalWindow(isSingle ? 'single_forward_modal' : 'multi_forward_modal');
}

function editPortFModal(isSingle, triggerEl)
{
	editRow=triggerEl.parentNode.parentNode;
	modalButtons = [
		{"title" : UI.CApplyChanges, "classes" : "btn btn-primary", "function" : function(){editForward(isSingle ? true : false,editRow);}},
		"defaultDiscard"
	];

	var desc = editRow.childNodes[0].firstChild.data;
	var prot = editRow.childNodes[1].firstChild.data;
	if(isSingle)
	{
		var fp = editRow.childNodes[2].firstChild.data;
		var ip = editRow.childNodes[3].firstChild.data;
		var dp = editRow.childNodes[4].firstChild.data;
	}
	else
	{
		var sp = editRow.childNodes[2].firstChild.data;
		var ep = editRow.childNodes[3].firstChild.data;
		var ip = editRow.childNodes[4].firstChild.data;
	}
	var zone = editRow.childNodes[5].firstChild.data;

	var r = isSingle ? "" : "r";
	modalElements = [
		{"id" : "add" + r + "_desc", "value" : desc},
		{"id" : "add" + r + "_prot", "value" : prot},
		{"id" : "add" + r + "_ip", "value" : ip},
		{"id" : "add" + r + "_src_zone", "options" : getWanZoneOptionsMap(), "value" : zone}
	];
	if(isSingle)
	{
		modalElements.push(
			{"id" : "add_fp", "value" : fp},
			{"id" : "add_dp", "value" : dp}
		);
	}
	else
	{
		modalElements.push(
			{"id" : "addr_sp", "value" : sp},
			{"id" : "addr_ep", "value" : ep}
		);
	}

	modalPrepare(isSingle ? 'single_forward_modal' : 'multi_forward_modal', prtS.PESect, modalElements, modalButtons);
	openModalWindow(isSingle ? 'single_forward_modal' : 'multi_forward_modal');
}

function proofreadOpenSingle(excludeRow)
{
	var addIds = ['addo_dp', 'addo_ip'];
	var labelIds = ['addo_dp_label', 'addo_ip_label'];
	var functions = [validateNumeric, validateIP6Range];
	var returnCodes = [0,0];
	var visibilityIds = addIds;

	var errors = proofreadFields(addIds, labelIds, functions, returnCodes, visibilityIds, document);

	if(errors.length == 0)
	{
		var portoTable = document.getElementById('porto_table_container').firstChild;
		var currentPortoData = getTableDataArray(portoTable, true, false);
		var addPort = document.getElementById('addo_dp').value;
		var addProtocol = document.getElementById('addo_prot').value;
		var addIP = document.getElementById('addo_ip').value;
		addIP = ip6_canonical(addIP);
		var addZone = document.getElementById('addo_src_zone').value;
		var rowDataIndex=0;
		for (rowDataIndex=0; rowDataIndex < currentPortoData.length; rowDataIndex++)
		{
			if(portoTable.rows[rowDataIndex+1] != excludeRow)
			{
				var rowData = currentPortoData[rowDataIndex];
				if( (addProtocol == rowData[1] || addProtocol == UI.both || rowData[1] == UI.both) &&  addPort == rowData[3] && addIP == rowData[2] && addZone == rowData[4])
				{
					errors.push(prtS.CopOErr);
				}
			}
		}

		var portoRangeTable = document.getElementById('portorange_table_container').firstChild;
		var currentRangeData = getTableDataArray(portoRangeTable, true, false);
		for (rowDataIndex=0; rowDataIndex < currentRangeData.length; rowDataIndex++)
		{
			var rowData = currentRangeData[rowDataIndex];
			if( (addProtocol == rowData[1] || addProtocol == UI.both || rowData[1] == UI.both) && rowData[2]*1 <= addPort*1 && rowData[3]*1 >= addPort*1 && addIP == rowData[4] && addZone == rowData[5])
			{
				errors.push(prtS.CopOErr);
			}
		}
	}

	return errors;
}

function proofreadOpenRange(excludeRow)
{
	var addIds = ['addor_sp', 'addor_ep', 'addor_ip'];
	var labelIds = ['addor_sp_label', 'addor_ep_label', 'addor_ip_label'];
	var functions = [validateNumeric, validateNumeric, validateIP6Range];
	var returnCodes = [0,0,0];
	var visibilityIds = addIds;
	var errors = proofreadFields(addIds, labelIds, functions, returnCodes, visibilityIds, document);
	if(errors.length == 0)
	{
		if( (1*document.getElementById('addor_sp').value) > (1*document.getElementById('addor_ep').value) )
		{
			errors.push(prtS.GTErr);
		}


		var portoTable = document.getElementById('porto_table_container').firstChild;
		var currentPortoData = getTableDataArray(portoTable, true, false);
		var addStartPort = document.getElementById('addor_sp').value;
		var addEndPort = document.getElementById('addor_ep').value;
		var addProtocol = document.getElementById('addor_prot').value;
		var addIP = document.getElementById('addor_ip').value;
		addIP = ip6_canonical(addIP);
		var addZone = document.getElementById('addor_src_zone').value;
		var rowDataIndex=0;
		for (rowDataIndex=0; rowDataIndex < currentPortoData.length ; rowDataIndex++)
		{
			var rowData = currentPortoData[rowDataIndex];
			if( (addProtocol == rowData[1] || addProtocol == UI.both || rowData[1] == UI.both) &&  addStartPort*1 <= rowData[3]*1 && addEndPort*1 >= rowData[3]*1 && addIP == rowData[2] && addZone == rowData[4])
			{
				errors.push(prtS.DupOErr);
			}
		}

		var portoRangeTable = document.getElementById('portorange_table_container').firstChild;
		var currentRangeData = getTableDataArray(portoRangeTable, true, false);
		for (rowDataIndex=0; rowDataIndex < currentRangeData.length; rowDataIndex++)
		{
			if(portoRangeTable.rows[rowDataIndex+1] != excludeRow)
			{
				var rowData = currentRangeData[rowDataIndex];
				if( (addProtocol == rowData[1] || addProtocol == UI.both || rowData[1] == UI.both) && rowData[2]*1 <= addEndPort*1 && rowData[3]*1 >= addStartPort*1 && addIP == rowData[4] && addZone == rowData[5])
				{
					errors.push(prtS.DupOErr);
				}
			}
		}
	}


	return errors;

}

function addPortoRule()
{
	errors = proofreadOpenSingle();
	if(errors.length > 0)
	{
		alert(errors.join("\n") + "\n\n"+prtS.AORErr);
	}
	else
	{
		values = new Array();
		ids = ['addo_desc', 'addo_prot', 'addo_ip', 'addo_dp', 'addo_src_zone'];
		for (idIndex in ids)
		{
			element = document.getElementById(ids[idIndex]);
			v = element.value;
			v = v== '' ? '-' : v;
			v = ids[idIndex] == "addo_ip" ? ip6_canonical(v) : v;
			values.push(v);
			if(element.type == "text")
			{
				element.value = "";
			}
		}

		//check if this is identical to another rule, but for a different protocol
		//if so, just merge the two by setting the protocol on the old data to 'both'
		portoTable = document.getElementById('porto_table_container').firstChild;
		currentPortoData = getTableDataArray(portoTable, true, false);
		otherProto = values[1] == 'TCP' ? 'UDP' : 'TCP';
		mergedWithExistingRule = false;
		for (rowDataIndex in currentPortoData)
		{
			rowData = currentPortoData[rowDataIndex];

			if( otherProto == rowData[1] &&  values[2] == rowData[2] && values[3] == rowData[3] && values[4] == rowData[4])
			{
				portoTable.rows[(rowDataIndex*1)+1].childNodes[1].firstChild.data = UI.both;
				if(values[0] != '-' && rowData[0] == '-')
				{
					portoTable.rows[(rowDataIndex*1)+1].childNodes[0].firstChild.data = values[0];
				}

				table1Container = document.getElementById('porto_table_container');
				if(table1Container.firstChild != null)
				{
					table1Container.removeChild(table1Container.firstChild);
				}
				table1Container.appendChild(portoTable);

				mergedWithExistingRule = true;
			}
		}

		if(!mergedWithExistingRule)
		{
			checkbox = createInput('checkbox');
			checkbox.checked = true;
			values.push(checkbox);
			values.push(createEditButton(true, "open"));
			addTableRow(portoTable,values, true, false);
		}
		closeModalWindow('single_open_modal');
	}
}

function addPortoRangeRule()
{
	errors = proofreadOpenRange();
	if(errors.length > 0)
	{
		alert(errors.join("\n") + "\n\n"+prtS.AORErr);
	}
	else
	{
		values = new Array();
		ids = ['addor_desc', 'addor_prot', 'addor_sp', 'addor_ep', 'addor_ip', 'addor_src_zone'];
		for (idIndex in ids)
		{
			element = document.getElementById(ids[idIndex]);
			v = element.value;
			v = v== '' ? '-' : v;
			v = ids[idIndex] == "addor_ip" ? ip6_canonical(v) : v;
			values.push(v);
			if(element.type == 'text')
			{
				element.value = "";
			}
		}

		portoRangeTable = document.getElementById('portorange_table_container').firstChild;
		currentRangeData = getTableDataArray(portoRangeTable, true, false);
		otherProto = values[1] == 'TCP' ? 'UDP' : 'TCP';
		mergedWithExistingRule = false;
		for (rowDataIndex in currentRangeData)
		{
			rowData = currentRangeData[rowDataIndex];
			if( otherProto == rowData[1] &&  values[2] == rowData[2] && values[3] == rowData[3] && values[4] == rowData[4] && values[5] == rowData[5])
			{
				portoRangeTable.rows[(rowDataIndex*1)+1].childNodes[1].firstChild.data = UI.both;
				if(values[0] != '-' && rowData[0] == '-')
				{
					portoRangeTable.rows[(rowDataIndex*1)+1].childNodes[0].firstChild.data = values[0];
				}

				table2Container = document.getElementById('portorange_table_container');
				if(table2Container.firstChild != null)
				{
					table2Container.removeChild(table2Container.firstChild);
				}
				table2Container.appendChild(portoRangeTable);

				mergedWithExistingRule = true;

			}
		}


		if(!mergedWithExistingRule)
		{
			checkbox = createInput('checkbox');
			checkbox.checked = true;
			values.push(checkbox);
			values.push(createEditButton(false, "open"));

			portorangeTable = document.getElementById('portorange_table_container').firstChild;
			addTableRow(portorangeTable,values, true, false);
		}
		closeModalWindow('multi_open_modal');
	}
}

function addPortOModal(isSingle)
{
	modalButtons = [
		{"title" : UI.Add, "classes" : "btn btn-primary", "function" : isSingle ? addPortoRule : addPortoRangeRule},
		"defaultDismiss"
	];

	var desc = "";
	var prot = "both";
	var dp = "";
	var ip = "";
	var sp = "";
	var ep = "";

	var r = isSingle ? "" : "r";
	modalElements = [
		{"id" : "addo" + r + "_desc", "value" : desc},
		{"id" : "addo" + r + "_prot", "value" : prot},
		{"id" : "addo" + r + "_ip", "value" : ip},
		{"id" : "addo" + r + "_src_zone", "options" : getWanZoneOptionsMap(), "value" : "wan"}
	];

	if(isSingle)
	{
		modalElements.push(
			{"id" : "addo_dp", "value" : dp}
		);
	}
	else
	{
		modalElements.push(
			{"id" : "addor_sp", "value" : sp},
			{"id" : "addor_ep", "value" : ep}
		);
	}

	modalPrepare(isSingle ? 'single_open_modal' : 'multi_open_modal', isSingle ? prtS.OpeIPort : prtS.OpeRPort, modalElements, modalButtons);
	openModalWindow(isSingle ? 'single_open_modal' : 'multi_open_modal');
}

function editOpen(isSingle, editRow)
{
	var errors;
	errors = isSingle ? proofreadOpenSingle(editRow) : proofreadOpenRange(editRow);

	if(errors.length > 0)
	{
		alert(errors.join("\n") + "\n"+prtS.UpErr);
	}
	else
	{
		var r = isSingle ? "" : "r";
		//update document with new data
		editRow.childNodes[0].firstChild.data = document.getElementById("addo" + r + "_desc").value;
		editRow.childNodes[1].firstChild.data = getSelectedValue( "addo" + r + "_prot", document );
		if(isSingle)
		{
			editRow.childNodes[2].firstChild.data = document.getElementById("addo_ip").value;
			editRow.childNodes[3].firstChild.data = document.getElementById("addo_dp").value;
			editRow.childNodes[4].firstChild.data = getSelectedValue( "addo_src_zone", document );
		}
		else
		{
			editRow.childNodes[2].firstChild.data = document.getElementById("addor_sp").value;
			editRow.childNodes[3].firstChild.data = document.getElementById("addor_ep").value;
			editRow.childNodes[4].firstChild.data = document.getElementById("addor_ip").value;
			editRow.childNodes[5].firstChild.data = getSelectedValue( "addor_src_zone", document );
		}
		closeModalWindow(isSingle ? "single_open_modal" : "multi_open_modal");
	}
}


function editPortOModal(isSingle, triggerEl)
{
	editRow=triggerEl.parentNode.parentNode;
	modalButtons = [
		{"title" : UI.CApplyChanges, "classes" : "btn btn-primary", "function" : function(){editOpen(isSingle ? true : false, editRow);}},
		"defaultDiscard"
	];

	var desc = editRow.childNodes[0].firstChild.data;
	var prot = editRow.childNodes[1].firstChild.data;

	var r = isSingle ? "" : "r";
	var zone = editRow.childNodes[isSingle ? 4 : 5].firstChild.data;
	modalElements = [
		{"id" : "addo" + r + "_desc", "value" : desc},
		{"id" : "addo" + r + "_prot", "value" : prot},
		{"id" : "addo" + r + "_src_zone", "options" : getWanZoneOptionsMap(), "value" : zone}
	];

	if(isSingle)
	{
		var ip = editRow.childNodes[2].firstChild.data;
		var dp = editRow.childNodes[3].firstChild.data;
		modalElements.push(
			{"id" : "addo_ip", "value" : ip},
			{"id" : "addo_dp", "value" : dp}
		);
	}
	else
	{
		var sp = editRow.childNodes[2].firstChild.data;
		var ep = editRow.childNodes[3].firstChild.data;
		var ip = editRow.childNodes[4].firstChild.data;
		modalElements.push(
			{"id" : "addor_sp", "value" : sp},
			{"id" : "addor_ep", "value" : ep},
			{"id" : "addor_ip", "value" : ip}
		);
	}

	modalPrepare(isSingle ? 'single_open_modal' : 'multi_open_modal', prtS.POESect, modalElements, modalButtons);
	openModalWindow(isSingle ? 'single_open_modal' : 'multi_open_modal');
}
